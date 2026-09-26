/** Updates on-chain prices of already-registered agents to match agents.json for the current PAY_MODE. */
import { parseUnits } from "viem";
import agents from "../src/agents/agents.json" with { type: "json" };
import { listAgents } from "../src/shared/registry.js";
import { registryAbi } from "../src/shared/abi.js";
import { registryAddress, orchestratorAccount, walletFor, publicClient, PAY_MODE, ASSET, ASSET_DECIMALS, txUrl } from "../src/shared/config.js";

const wallet = walletFor(orchestratorAccount());
const onchain = await listAgents();
for (const a of agents) {
  const row = onchain.find((r) => r.name === a.name);
  if (!row) { console.log(`skip ${a.name}: not registered`); continue; }
  const human = PAY_MODE === "avax" ? a.priceAvax : a.priceUsdc;
  const price = parseUnits(human, ASSET_DECIMALS);
  if (row.pricePerCall === price) { console.log(`ok   ${a.name} already ${human} ${ASSET}`); continue; }
  const hash = await wallet.writeContract({ address: registryAddress(), abi: registryAbi, functionName: "updateAgent", args: [BigInt(row.id), row.endpoint, price, true] });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`set  ${a.name} -> ${human} ${ASSET}  ${txUrl(hash)}`);
}
