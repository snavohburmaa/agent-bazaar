import { publicClient, registryAddress, orchestratorAccount, walletFor } from "./config.js";
import { registryAbi } from "./abi.js";
import { parseEventLogs, type Hex } from "viem";

export interface AgentListing {
  id: number;
  owner: string;
  payTo: Hex;
  name: string;
  category: string;
  endpoint: string;
  pricePerCall: bigint;
  active: boolean;
  jobsRated: number;
  ratingSum: number;
  avgRating: number; // 0 when unrated
}

export async function listAgents(): Promise<AgentListing[]> {
  const rows = await publicClient.readContract({ address: registryAddress(), abi: registryAbi, functionName: "getAgents" });
  return rows.map((r, id) => ({
    id,
    owner: r.owner,
    payTo: r.payTo as Hex,
    name: r.name,
    category: r.category,
    endpoint: r.endpoint,
    pricePerCall: r.pricePerCall,
    active: r.active,
    jobsRated: Number(r.jobsRated),
    ratingSum: Number(r.ratingSum),
    avgRating: Number(r.jobsRated) === 0 ? 0 : Number(r.ratingSum) / Number(r.jobsRated),
  }));
}

/** Pays an agent through the registry. Returns the tx hash and the on-chain payment reference. */
export async function payAgentOnChain(id: number, amount: bigint): Promise<{ txHash: Hex; paymentRef: Hex }> {
  const account = orchestratorAccount();
  const wallet = walletFor(account);
  const txHash = await wallet.writeContract({
    address: registryAddress(), abi: registryAbi, functionName: "payAgent", args: [BigInt(id)], value: amount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const paid = parseEventLogs({ abi: registryAbi, eventName: "AgentPaid", logs: receipt.logs })[0];
  if (!paid) throw new Error("payAgent succeeded but emitted no AgentPaid event");
  return { txHash, paymentRef: paid.args.paymentRef as Hex };
}

/** Verifies (server side) that a tx hash is a registry payment for `agentId` of at least `minAmount`. */
export async function verifyRegistryPayment(txHash: Hex, agentId: number, minAmount: bigint): Promise<{ ok: boolean; reason?: string; payer?: Hex; paymentRef?: Hex }> {
  let receipt;
  try { receipt = await publicClient.getTransactionReceipt({ hash: txHash }); }
  catch { return { ok: false, reason: "transaction not found" }; }
  if (receipt.status !== "success") return { ok: false, reason: "transaction reverted" };
  const logs = parseEventLogs({ abi: registryAbi, eventName: "AgentPaid", logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === registryAddress().toLowerCase());
  const hit = logs.find((l) => Number(l.args.id) === agentId && l.args.amount >= minAmount);
  if (!hit) return { ok: false, reason: `no AgentPaid event for agent ${agentId} with amount >= ${minAmount}` };
  return { ok: true, payer: hit.args.payer as Hex, paymentRef: hit.args.paymentRef as Hex };
}

/** Rates a payment reference. Only the payer can do this, enforced by the contract. */
export async function rateJob(paymentRef: Hex, score: number): Promise<Hex> {
  const account = orchestratorAccount();
  const wallet = walletFor(account);
  const hash = await wallet.writeContract({
    address: registryAddress(), abi: registryAbi, functionName: "rateJob", args: [paymentRef, score],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function registerAgent(name: string, category: string, endpoint: string, payTo: Hex, price: bigint): Promise<Hex> {
  const account = orchestratorAccount();
  const wallet = walletFor(account);
  const hash = await wallet.writeContract({
    address: registryAddress(), abi: registryAbi, functionName: "registerAgent",
    args: [name, category, endpoint, payTo, price],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
