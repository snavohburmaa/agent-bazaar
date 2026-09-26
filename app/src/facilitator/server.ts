/**
 * Self-hosted x402 facilitator for Avalanche Fuji.
 * Verifies EIP-3009 payment authorizations and settles them on chain
 * (calls USDC.transferWithAuthorization, paying the gas itself).
 * Exposes the three endpoints @x402/core's HTTPFacilitatorClient expects.
 */
import express from "express";
import cors from "cors";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { NETWORK, publicClient, facilitatorAccount, walletFor } from "../shared/config.js";

const account = facilitatorAccount();
const wallet = walletFor(account);

const signer = toFacilitatorEvmSigner({
  address: account.address,
  readContract: (args) => publicClient.readContract(args as Parameters<typeof publicClient.readContract>[0]),
  verifyTypedData: (args) => publicClient.verifyTypedData(args as Parameters<typeof publicClient.verifyTypedData>[0]),
  writeContract: (args) => wallet.writeContract(args as Parameters<typeof wallet.writeContract>[0]),
  sendTransaction: (args) => wallet.sendTransaction(args),
  waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
  getCode: (args) => publicClient.getCode(args),
});

const facilitator = new x402Facilitator().register(NETWORK, new ExactEvmScheme(signer));

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/supported", (_req, res) => res.json(facilitator.getSupported()));
app.get("/health", (_req, res) => res.json({ ok: true, facilitator: account.address, network: NETWORK }));

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    const out = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(out);
  } catch (e: any) {
    console.error("[facilitator] verify error", e?.message);
    res.status(400).json({ isValid: false, invalidReason: e?.message ?? "verify failed" });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    const out = await facilitator.settle(paymentPayload, paymentRequirements);
    console.log("[facilitator] settled", out.transaction);
    res.json(out);
  } catch (e: any) {
    console.error("[facilitator] settle error", e?.message);
    res.status(400).json({ success: false, errorReason: e?.message ?? "settle failed", transaction: "", network: NETWORK });
  }
});

const port = Number(process.env.FACILITATOR_PORT ?? 4100);
app.listen(port, () => console.log(`[facilitator] listening on :${port} as ${account.address} (${NETWORK})`));
