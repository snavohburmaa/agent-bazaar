/** Pays one agent once, end to end, and prints the settlement tx. Use this to prove the payment rail works. */
import { parseUnits } from "viem";
import agents from "../src/agents/agents.json" with { type: "json" };
import { pay, callWithProof, callPaidX402 } from "../src/orchestrator/payment.js";
import { listAgents } from "../src/shared/registry.js";
import { providerAddress, txUrl, PAY_MODE, ASSET, ASSET_DECIMALS } from "../src/shared/config.js";

const key = process.argv[2] ?? "news";
const a = agents.find((x) => x.key === key)!;
const human = PAY_MODE === "avax" ? a.priceAvax : a.priceUsdc;
console.log(`paying ${a.name} ${human} ${ASSET} via ${PAY_MODE} ...`);
const t0 = Date.now();
const endpoint = `http://localhost:${a.port}/analyze`;
let proof, result;
if (PAY_MODE === "x402") ({ proof, result } = await callPaidX402(endpoint, "Give me two recent Avalanche developments.", ""));
else {
  const id = (await listAgents()).find((r) => r.name === a.name)?.id;
  if (id === undefined) throw new Error(`${a.name} is not registered; run npm run seed`);
  proof = await pay(id, providerAddress(), parseUnits(human, ASSET_DECIMALS));
  console.log(`paid in ${Date.now() - t0}ms  tx=${proof.txHash}  ref=${proof.paymentRef}`);
  result = await callWithProof(endpoint, proof, "Give me two recent Avalanche developments.", "", 90_000);
}
console.log(`done in ${Date.now() - t0}ms  ${txUrl(proof.txHash)}`);
console.log(JSON.stringify(result, null, 2));
