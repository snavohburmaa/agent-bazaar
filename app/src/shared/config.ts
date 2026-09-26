import "dotenv/config";
import { avalancheFuji } from "viem/chains";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function req(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`${name} is empty. Open ~/Desktop/agentbazzar/app/.env and fill in the line marked FILL for ${name}.`);
  return v;
}
/** Accepts hex with or without 0x, validates length (32-byte key = 64 hex chars, address = 40). */
function hex(name: string, chars: number): Hex {
  let v = req(name).replace(/^['"]|['"]$/g, "");
  if (!/^0x/i.test(v)) v = "0x" + v;
  if (!new RegExp(`^0x[0-9a-fA-F]{${chars}}$`).test(v)) throw new Error(`${name} should be ${chars} hex characters (optionally prefixed with 0x); got ${v.length - 2}.`);
  return v as Hex;
}

export const RPC_URL = process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
export const CHAIN = avalancheFuji;
export const NETWORK = "eip155:43113" as const;
export const USDC_ADDRESS = (process.env.USDC_ADDRESS ?? "0x5425890298aed601595a70AB815c96711a31Bc65") as Hex;
export const USDC_DECIMALS = 6;
export const PAY_MODE = (process.env.PAY_MODE ?? "avax") as "x402" | "direct" | "avax";
/** Payment asset: native AVAX in avax mode, Fuji USDC otherwise. */
export const ASSET = PAY_MODE === "avax" ? "AVAX" : "USDC";
export const ASSET_DECIMALS = PAY_MODE === "avax" ? 18 : 6;
export const toBase = (human: number | string) => BigInt(Math.round(Number(human) * 10 ** ASSET_DECIMALS));
export const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4100";
export const MODEL = process.env.MODEL ?? "claude-opus-5";
export const SNOWTRACE = "https://testnet.snowtrace.io";

export const registryAddress = () => hex("REGISTRY_ADDRESS", 40);
export const providerAddress = () => hex("PROVIDER_ADDRESS", 40);

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

export function orchestratorAccount() {
  return privateKeyToAccount(hex("PRIVATE_KEY", 64));
}
export function facilitatorAccount() {
  return privateKeyToAccount(process.env.FACILITATOR_PRIVATE_KEY?.trim() ? hex("FACILITATOR_PRIVATE_KEY", 64) : hex("PRIVATE_KEY", 64));
}
export function walletFor(account: ReturnType<typeof privateKeyToAccount>) {
  return createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });
}

export const txUrl = (hash: string) => `${SNOWTRACE}/tx/${hash}`;
export const addrUrl = (addr: string) => `${SNOWTRACE}/address/${addr}`;
/** Format base units of the payment asset as a short human number. */
export const usdc = (baseUnits: bigint | number | string) => (Number(baseUnits) / 10 ** ASSET_DECIMALS).toFixed(ASSET_DECIMALS === 18 ? 6 : 4).replace(/0+$/, "").replace(/\.$/, "");
