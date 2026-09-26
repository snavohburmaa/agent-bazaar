/** Registers every agent in src/agents/agents.json on the deployed AgentRegistry. */
import { parseUnits } from "viem";
import agents from "../src/agents/agents.json" with { type: "json" };
import { registerAgent, listAgents } from "../src/shared/registry.js";
import { providerAddress, txUrl, PAY_MODE, ASSET, ASSET_DECIMALS } from "../src/shared/config.js";

const host = process.env.AGENT_HOST ?? "http://localhost";
const existing = await listAgents();
for (const a of agents) {
  if ((a as any).seed === false) { console.log(`skip ${a.name} (register it live from the UI)`); continue; }
  if (existing.some((e) => e.name === a.name)) { console.log(`skip ${a.name} (already registered)`); continue; }
  const endpoint = `${host}:${a.port}/analyze`;
  const human = PAY_MODE === "avax" ? a.priceAvax : a.priceUsdc;
  const tx = await registerAgent(a.name, a.category, endpoint, providerAddress(), parseUnits(human, ASSET_DECIMALS));
  console.log(`registered ${a.name} at ${endpoint} for ${human} ${ASSET}  ${txUrl(tx)}`);
}
console.table((await listAgents()).map((a) => ({ id: a.id, name: a.name, category: a.category, price: Number(a.pricePerCall) / 10 ** ASSET_DECIMALS, endpoint: a.endpoint, rated: a.jobsRated, avg: a.avgRating })));
