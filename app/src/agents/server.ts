/**
 * Specialist agent server. One process per agent, selected with AGENT=<key>.
 * POST /analyze is protected by x402 (PAY_MODE=x402) or by a direct USDC transfer proof (PAY_MODE=direct).
 */
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { z } from "zod";
import { structured, MOCK, PROVIDER } from "../shared/llm.js";
import { parseUnits, type Hex } from "viem";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import agents from "./agents.json" with { type: "json" };
import { NETWORK, USDC_ADDRESS, PAY_MODE, ASSET, ASSET_DECIMALS, FACILITATOR_URL, providerAddress, publicClient } from "../shared/config.js";
import { verifyDirectPayment, verifyNativePayment } from "../shared/usdc.js";

const key = process.env.AGENT ?? "news";
const found = agents.find((a) => a.key === key);
if (!found) throw new Error(`Unknown AGENT=${key}. Options: ${agents.map((a) => a.key).join(", ")}`);
const def = found;

const priceHuman = PAY_MODE === "avax" ? def.priceAvax : def.priceUsdc;
const price = parseUnits(priceHuman, ASSET_DECIMALS);
const payTo = providerAddress();

const Result = z.object({
  summary: z.string(),
  facts: z.array(z.string()),
  sources: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const app = express();
app.use(cors({ exposedHeaders: ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE", "X-Payment-Tx"] }));
app.use(express.json());

app.get("/", (_req, res) => res.json({ agent: def.name, category: def.category, price: priceHuman, asset: ASSET, payTo, mode: PAY_MODE }));

// ---------- payment guard ----------
async function waitForFacilitator(url: string, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`facilitator at ${url} did not come up within ${ms}ms`);
}

if (PAY_MODE === "x402") {
  await waitForFacilitator(FACILITATOR_URL);
  const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());
  app.use(
    paymentMiddleware(
      {
        "POST /analyze": {
          accepts: {
            scheme: "exact",
            network: NETWORK,
            payTo,
            // Fuji USDC is not in the SDK's default asset table, so give the full asset amount + EIP-712 domain.
            price: { asset: USDC_ADDRESS, amount: price.toString(), extra: { name: "USD Coin", version: "2" } },
            maxTimeoutSeconds: 120,
          },
          description: `${def.name} (${def.category}) analysis`,
          mimeType: "application/json",
        },
      },
      server,
    ),
  );
} else {
  const used = new Set<string>();
  app.use("/analyze", async (req: Request, res: Response, next: NextFunction) => {
    const tx = (req.header("X-Payment-Tx") ?? "") as Hex;
    if (!tx) {
      res.status(402).json({ error: "Payment Required", mode: PAY_MODE, payTo, asset: PAY_MODE === "avax" ? "AVAX" : USDC_ADDRESS, amount: price.toString(), network: NETWORK });
      return;
    }
    if (used.has(tx.toLowerCase())) {
      res.status(402).json({ error: "payment already used" });
      return;
    }
    const v = PAY_MODE === "avax" ? await verifyNativePayment(tx, payTo, price) : await verifyDirectPayment(tx, payTo, price);
    if (!v.ok) {
      res.status(402).json({ error: v.reason });
      return;
    }
    used.add(tx.toLowerCase());
    res.setHeader("X-Payment-Tx", tx);
    next();
  });
}

// ---------- the actual work ----------
async function liveChainContext(): Promise<string> {
  if (def.category !== "onchain") return "";
  try {
    const [block, gas] = await Promise.all([publicClient.getBlock(), publicClient.getGasPrice()]);
    const prev = await publicClient.getBlock({ blockNumber: block.number - 100n });
    const secs = Number(block.timestamp - prev.timestamp);
    return [
      `Live Avalanche Fuji C-Chain metrics (from RPC):`,
      `- latest block: ${block.number}`,
      `- txs in latest block: ${block.transactions.length}`,
      `- gas used / limit: ${block.gasUsed} / ${block.gasLimit}`,
      `- base fee: ${Number(block.baseFeePerGas ?? 0n) / 1e9} nAVAX, gas price: ${Number(gas) / 1e9} nAVAX`,
      `- avg block time over last 100 blocks: ${(secs / 100).toFixed(2)}s`,
    ].join("\n");
  } catch (e: any) {
    return `Live metrics unavailable: ${e?.message}`;
  }
}

app.post("/analyze", async (req, res) => {
  const { task, context } = req.body ?? {};
  if (!task) {
    res.status(400).json({ error: "task required" });
    return;
  }
  const started = Date.now();
  try {
    const chain = await liveChainContext();
    if (MOCK) {
      const out = def.quality === "bad"
        ? { summary: "Things seem fine I guess.", facts: [], sources: [], confidence: 0.2 }
        : { summary: `Mock ${def.name} answer for: ${task}`, facts: ["Fact one from mock data", "Fact two from mock data", chain || "no chain data"], sources: ["Avalanche Blog", "Snowtrace"], confidence: 0.85 };
      res.json({ ...out, agent: def.name, ms: Date.now() - started });
      return;
    }
    const out = await structured(def.persona, `Task: ${task}\n${context ? `Context: ${context}\n` : ""}${chain}`, Result, "analysis");
    console.log(`[${def.key}] answered in ${Date.now() - started}ms`);
    res.json({ ...out, agent: def.name, ms: Date.now() - started });
  } catch (e: any) {
    console.error(`[${def.key}] error`, e?.message);
    res.status(500).json({ error: e?.message ?? "agent failed" });
  }
});

app.listen(def.port, () => console.log(`[${def.key}] ${def.name} on :${def.port}  price=${priceHuman} ${ASSET}  mode=${PAY_MODE}  llm=${PROVIDER}  payTo=${payTo}`));
