import { publicClient, USDC_ADDRESS, orchestratorAccount, walletFor } from "./config.js";
import { erc20Abi } from "./abi.js";
import { parseEventLogs, type Hex } from "viem";

export async function usdcBalance(addr: Hex): Promise<bigint> {
  return publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
}

/** Direct mode: orchestrator transfers USDC to payTo and returns the tx hash as payment proof. */
export async function payDirect(to: Hex, amount: bigint): Promise<Hex> {
  const account = orchestratorAccount();
  const wallet = walletFor(account);
  const hash = await wallet.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Direct mode (server side): confirm a tx hash is a USDC transfer of at least `minAmount` to `payTo`. */
export async function verifyDirectPayment(hash: Hex, payTo: Hex, minAmount: bigint): Promise<{ ok: boolean; reason?: string; from?: Hex }> {
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch {
    return { ok: false, reason: "transaction not found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "transaction reverted" };
  const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const hit = logs.find(
    (l) => l.address.toLowerCase() === USDC_ADDRESS.toLowerCase() && l.args.to.toLowerCase() === payTo.toLowerCase() && l.args.value >= minAmount,
  );
  if (!hit) return { ok: false, reason: "no matching USDC transfer to payTo" };
  return { ok: true, from: hit.args.from as Hex };
}

/** AVAX mode: orchestrator sends native AVAX to payTo and returns the tx hash as payment proof. */
export async function payNative(to: Hex, amount: bigint): Promise<Hex> {
  const account = orchestratorAccount();
  const wallet = walletFor(account);
  const hash = await wallet.sendTransaction({ to, value: amount });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** AVAX mode (server side): confirm a tx hash is a successful native transfer of at least `minAmount` to `payTo`. */
export async function verifyNativePayment(hash: Hex, payTo: Hex, minAmount: bigint): Promise<{ ok: boolean; reason?: string; from?: Hex }> {
  let tx, receipt;
  try {
    [tx, receipt] = await Promise.all([publicClient.getTransaction({ hash }), publicClient.getTransactionReceipt({ hash })]);
  } catch {
    return { ok: false, reason: "transaction not found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "transaction reverted" };
  if ((tx.to ?? "").toLowerCase() !== payTo.toLowerCase()) return { ok: false, reason: "transaction is not to payTo" };
  if (tx.value < minAmount) return { ok: false, reason: `paid ${tx.value} < price ${minAmount}` };
  return { ok: true, from: tx.from as Hex };
}
