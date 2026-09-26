import type { Request, Response, NextFunction } from "express";
import type { Hex } from "viem";

export type Verifier = (txHash: Hex) => Promise<{ ok: boolean; reason?: string }>;

/**
 * Express guard for a paid endpoint (avax and direct modes).
 * Requires an X-Payment-Tx header, verifies it once, and rejects reuse of the same hash.
 */
export function makePaymentGuard(verify: Verifier, describe402: () => Record<string, unknown>, used: Set<string> = new Set()) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const tx = (req.header("X-Payment-Tx") ?? "").trim() as Hex;
    if (!tx) { res.status(402).json({ error: "Payment Required", ...describe402() }); return; }
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) { res.status(402).json({ error: "malformed payment tx hash" }); return; }
    const key = tx.toLowerCase();
    if (used.has(key)) { res.status(402).json({ error: "payment already used" }); return; }
    const v = await verify(tx);
    if (!v.ok) { res.status(402).json({ error: v.reason ?? "payment not verified" }); return; }
    used.add(key);
    res.setHeader("X-Payment-Tx", tx);
    next();
  };
}
