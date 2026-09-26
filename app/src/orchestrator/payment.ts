/**
 * Pays a specialist agent and returns its result plus the settlement tx hash.
 * PAY_MODE=x402   -> wrapFetchWithPayment handles the 402 -> sign -> retry dance; tx hash comes from the PAYMENT-RESPONSE header.
 * PAY_MODE=direct -> transfer USDC first, then call with X-Payment-Tx.
 */
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import type { Hex } from "viem";
import { NETWORK, PAY_MODE, USDC_ADDRESS, publicClient, orchestratorAccount } from "../shared/config.js";
import { payDirect, payNative } from "../shared/usdc.js";

export interface PaidResult {
  txHash: Hex;
  body: any;
  ms: number;
}

let fetchWithPay: ReturnType<typeof wrapFetchWithPayment> | null = null;
function x402Fetch() {
  if (fetchWithPay) return fetchWithPay;
  const account = orchestratorAccount();
  const signer = toClientEvmSigner(
    {
      address: account.address,
      signTypedData: (msg) => account.signTypedData(msg as Parameters<typeof account.signTypedData>[0]),
    },
    publicClient,
  );
  // Fuji USDC is not in the SDK's default asset table, so allow it explicitly.
  // The per-payment cap is a second safety net under the session budget guard.
  const client = new x402Client()
    .register(NETWORK, new ExactEvmScheme(signer))
    .setSpendControls({ allowedAssets: [{ network: NETWORK, asset: USDC_ADDRESS, maxAmountPerPayment: "1000000" }] });
  fetchWithPay = wrapFetchWithPayment(fetch, client);
  return fetchWithPay;
}

export async function payAndCall(endpoint: string, payTo: Hex, price: bigint, task: string, context: string, timeoutMs = 60_000): Promise<PaidResult> {
  const started = Date.now();
  const body = JSON.stringify({ task, context });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (PAY_MODE === "direct" || PAY_MODE === "avax") {
      const txHash = PAY_MODE === "avax" ? await payNative(payTo, price) : await payDirect(payTo, price);
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "X-Payment-Tx": txHash }, body, signal: ctrl.signal });
      if (!res.ok) throw new Error(`agent returned ${res.status}: ${await res.text()}`);
      return { txHash, body: await res.json(), ms: Date.now() - started };
    }
    const res = await x402Fetch()(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ctrl.signal });
    if (!res.ok) throw new Error(`agent returned ${res.status}: ${await res.text()}`);
    const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    let txHash: Hex = "0x" as Hex;
    if (header) {
      const settle = decodePaymentResponseHeader(header);
      txHash = (settle.transaction ?? "0x") as Hex;
    }
    return { txHash, body: await res.json(), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
