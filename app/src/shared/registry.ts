import { publicClient, registryAddress, orchestratorAccount, walletFor } from "./config.js";
import { registryAbi } from "./abi.js";
import type { Hex } from "viem";

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

export async function rateJob(id: number, score: number, paymentRef: Hex): Promise<Hex> {
  const account = orchestratorAccount();
  const wallet = walletFor(account);
  const hash = await wallet.writeContract({
    address: registryAddress(), abi: registryAbi, functionName: "rateJob",
    args: [BigInt(id), score, paymentRef],
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
