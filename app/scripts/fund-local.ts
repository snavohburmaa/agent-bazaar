/**
 * LOCAL TESTING ONLY. On an anvil fork of Fuji, gives the orchestrator wallet AVAX and USDC
 * by writing the USDC balance storage slot directly. Never works (or is needed) on real Fuji.
 */
import { createTestClient, http, keccak256, encodeAbiParameters, parseUnits, toHex, pad } from "viem";
import { avalancheFuji } from "viem/chains";
import { RPC_URL, USDC_ADDRESS, orchestratorAccount, facilitatorAccount } from "../src/shared/config.js";
import { usdcBalance } from "../src/shared/usdc.js";

const test = createTestClient({ chain: avalancheFuji, mode: "anvil", transport: http(RPC_URL) });
for (const acct of [orchestratorAccount(), facilitatorAccount()]) {
  await test.setBalance({ address: acct.address, value: parseUnits("100", 18) });
}
const me = orchestratorAccount().address;
// FiatTokenV2 (Circle USDC) keeps `balances` in slot 9.
const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [me, 9n]));
await test.setStorageAt({ address: USDC_ADDRESS, index: slot, value: pad(toHex(parseUnits("100", 6))) });
console.log(`orchestrator ${me} USDC = ${Number(await usdcBalance(me)) / 1e6}`);
