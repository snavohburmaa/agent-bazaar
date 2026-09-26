/** Preflight: prints wallet balances, registry state, and whether each service answers. */
import { formatEther } from "viem";
import { publicClient, orchestratorAccount, providerAddress, PAY_MODE, FACILITATOR_URL, txUrl, addrUrl } from "../src/shared/config.js";
import { usdcBalance } from "../src/shared/usdc.js";
import { listAgents } from "../src/shared/registry.js";
import agents from "../src/agents/agents.json" with { type: "json" };

const me = orchestratorAccount().address;
const avax = await publicClient.getBalance({ address: me });
const usdcBal = await usdcBalance(me);
console.log(`orchestrator ${me}  ${addrUrl(me)}`);
console.log(`  AVAX ${formatEther(avax)}   USDC ${Number(usdcBal) / 1e6}`);
if (avax < 10n ** 17n) console.log("  WARNING: below 0.1 AVAX, get more from the faucet");
if (PAY_MODE !== "avax" && usdcBal < 500_000n) console.log("  WARNING: below 0.5 USDC, get more from faucet.circle.com (Avalanche Fuji)");
console.log(`provider     ${providerAddress()}  USDC ${Number(await usdcBalance(providerAddress())) / 1e6}`);
console.log(`pay mode     ${PAY_MODE}`);
try {
  const rows = await listAgents();
  console.log(`registry     ${process.env.REGISTRY_ADDRESS}  agents=${rows.length}`);
} catch (e: any) { console.log(`registry     NOT READY: ${e?.message?.split("\n")[0]}`); }
const ping = async (name: string, url: string) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); console.log(`${name.padEnd(12)} ${r.ok ? "up" : "status " + r.status}  ${url}`); }
  catch { console.log(`${name.padEnd(12)} DOWN  ${url}`); }
};
if (PAY_MODE === "x402") await ping("facilitator", `${FACILITATOR_URL}/health`);
for (const a of agents) await ping(a.key, `http://localhost:${a.port}/`);
await ping("orchestrator", `http://localhost:${process.env.ORCHESTRATOR_PORT ?? 3000}/api/config`);
