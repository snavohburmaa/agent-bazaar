/** Pays one agent once, end to end, and prints the settlement tx. Use this to prove the payment rail works. */
import { parseUnits } from "viem";
import agents from "../src/agents/agents.json" with { type: "json" };
import { payAndCall } from "../src/orchestrator/payment.js";
import { providerAddress, txUrl, PAY_MODE, ASSET, ASSET_DECIMALS } from "../src/shared/config.js";

const key = process.argv[2] ?? "news";
const a = agents.find((x) => x.key === key)!;
const human = PAY_MODE === "avax" ? a.priceAvax : a.priceUsdc;
console.log(`paying ${a.name} ${human} ${ASSET} via ${PAY_MODE} ...`);
const r = await payAndCall(`http://localhost:${a.port}/analyze`, providerAddress(), parseUnits(human, ASSET_DECIMALS), "Give me two recent Avalanche developments.", "", 90_000);
console.log(`settled in ${r.ms}ms  tx=${r.txHash}  ${txUrl(r.txHash)}`);
console.log(JSON.stringify(r.body, null, 2));
