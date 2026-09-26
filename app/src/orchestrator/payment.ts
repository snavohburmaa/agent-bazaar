/**
 * Payment rails and agent calls.
 *  avax   -> pay through AgentRegistry.payAgent (records payer + reference on chain), then call with X-Payment-Tx.
 *  direct -> USDC transfer, then call with X-Payment-Tx.
 *  x402   -> wrapFetchWithPayment handles 402 -> sign -> retry atomically; tx hash from the PAYMENT-RESPONSE header.
 */
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { z } from "zod";
import type { Hex } from "viem";
import { NETWORK, PAY_MODE, USDC_ADDRESS, publicClient, orchestratorAccount } from "../shared/config.js";
import { payDirect } from "../shared/usdc.js";
import { payAgentOnChain } from "../shared/registry.js";

export const AgentResult = z.object({
  summary: z.string().min(1),
  facts: z.array(z.string()),
  sources: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
}).passthrough();
export type AgentResultT = z.infer<typeof AgentResult>;

export interface PaymentProof { txHash: Hex; paymentRef: Hex | null }

/** Step 1: pay. Throws only if the payment itself fails; a successful return means money moved. */
export async function pay(agentId: number, payTo: Hex, price: bigint): Promise<PaymentProof> {
  if (PAY_MODE === "avax") return payAgentOnChain(agentId, price);
  if (PAY_MODE === "direct") return { txHash: await payDirect(payTo, price), paymentRef: null };
  throw new Error("x402 mode pays inside callPaid()");
}

/** Step 2: call the agent with proof of payment and validate the response shape. */
export async function callWithProof(endpoint: string, proof: PaymentProof, task: string, context: string, timeoutMs = 45_000): Promise<AgentResultT> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "X-Payment-Tx": proof.txHash }, body: JSON.stringify({ task, context }), signal: ctrl.signal });
    if (!res.ok) throw new Error(`agent returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return parseResult(await res.json());
  } finally { clearTimeout(timer); }
}

export function parseResult(body: unknown): AgentResultT {
  const r = AgentResult.safeParse(body);
  if (!r.success) throw new Error(`malformed agent response: ${r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  return r.data;
}

// ---- x402 (atomic pay + call) ----
let fetchWithPay: ReturnType<typeof wrapFetchWithPayment> | null = null;
function x402Fetch() {
  if (fetchWithPay) return fetchWithPay;
  const account = orchestratorAccount();
  const signer = toClientEvmSigner({ address: account.address, signTypedData: (msg) => account.signTypedData(msg as Parameters<typeof account.signTypedData>[0]) }, publicClient);
  const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer))
    .setSpendControls({ allowedAssets: [{ network: NETWORK, asset: USDC_ADDRESS, maxAmountPerPayment: "1000000" }] });
  fetchWithPay = wrapFetchWithPayment(fetch, client);
  return fetchWithPay;
}

export async function callPaidX402(endpoint: string, task: string, context: string, timeoutMs = 60_000): Promise<{ proof: PaymentProof; result: AgentResultT }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await x402Fetch()(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, context }), signal: ctrl.signal });
    const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    if (!header) throw new Error("agent answered without an x402 settlement header; no payment was made");
    const settle = decodePaymentResponseHeader(header);
    const proof: PaymentProof = { txHash: (settle.transaction ?? "0x") as Hex, paymentRef: null };
    if (!res.ok) throw Object.assign(new Error(`agent returned ${res.status} after payment`), { proof });
    return { proof, result: parseResult(await res.json()) };
  } finally { clearTimeout(timer); }
}
