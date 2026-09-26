import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import { reportHtml } from "./report-html.js";
import { Session } from "./session.js";
import { listAgents } from "../shared/registry.js";
import { usdc, addrUrl, registryAddress, orchestratorAccount, PAY_MODE, ASSET, USDC_ADDRESS, NETWORK, publicClient } from "../shared/config.js";
import { usdcBalance } from "../shared/usdc.js";
import { RefusalError } from "../shared/llm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map<string, Session>();
let agentCache: { at: number; data: any } | null = null;

app.get("/api/config", async (_req, res) => {
  const me = orchestratorAccount().address;
  let balance = "?";
  try { balance = usdc(PAY_MODE === "avax" ? await publicClient.getBalance({ address: me }) : await usdcBalance(me)); } catch {}
  res.json({ registry: registryAddress(), registryUrl: addrUrl(registryAddress()), orchestrator: me, orchestratorUrl: addrUrl(me), usdc: USDC_ADDRESS, network: NETWORK, payMode: PAY_MODE, asset: ASSET, orchestratorBalance: balance, orchestratorUsdc: balance });
});

app.get("/api/agents", async (_req, res) => {
  try {
    if (!agentCache || Date.now() - agentCache.at > 10_000) {
      const rows = await listAgents();
      agentCache = { at: Date.now(), data: rows.map((a) => ({ ...a, pricePerCall: usdc(a.pricePerCall), price: usdc(a.pricePerCall), avgRating: +a.avgRating.toFixed(2) })) };
    }
    res.json(agentCache.data);
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

/** Checks that a candidate agent endpoint is alive and demands payment when called without proof. */
app.post("/api/agents/probe", async (req, res) => {
  const url = String(req.body?.endpoint ?? "").trim();
  if (!/^https?:\/\//i.test(url)) { res.status(400).json({ ok: false, reason: "endpoint must start with http:// or https://" }); return; }
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "probe" }), signal: AbortSignal.timeout(5000) });
    if (r.status === 402) { res.json({ ok: true, reason: "endpoint is up and asks for payment (402)" }); return; }
    res.json({ ok: false, reason: `endpoint answered ${r.status} without payment; it should answer 402` });
  } catch (e: any) {
    res.json({ ok: false, reason: `could not reach endpoint: ${e?.name === "TimeoutError" ? "timeout" : e?.message}` });
  }
});

app.post("/api/sessions", async (req, res) => {
  const { question, budget_usdc } = req.body ?? {};
  if (!question || !budget_usdc) { res.status(400).json({ error: "question and budget_usdc required" }); return; }
  try {
    const s = new Session(String(question), Number(budget_usdc));
    await s.createPlan();
    sessions.set(s.id, s);
    res.json({ session_id: s.id, plan: s.toPlanJson(), estimated_cost: usdc(s.estimate()) });
  } catch (e: any) {
    if (e instanceof RefusalError) { res.status(422).json({ error: e.message, refused: true }); return; }
    res.status(500).json({ error: e?.message });
  }
});

app.post("/api/sessions/:id/approve", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) { res.status(404).json({ error: "no such session" }); return; }
  if (s.status !== "planned") { res.status(409).json({ error: `session is ${s.status}` }); return; }
  const { budget_usdc, excluded_agent_ids } = req.body ?? {};
  agentCache = null;
  void s.run({ budgetUsdc: budget_usdc ? Number(budget_usdc) : undefined, excludedAgentIds: excluded_agent_ids });
  res.json({ ok: true });
});

app.get("/api/sessions/:id/events", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) { res.status(404).end(); return; }
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders();
  const send = (e: any) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  for (const e of s.events) send(e);
  s.listeners.add(send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => { s.listeners.delete(send); clearInterval(ping); });
});

app.get("/api/sessions/:id/report", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) { res.status(404).json({ error: "no such session" }); return; }
  res.json(s.toReport());
});

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
app.get("/api/sessions/:id/report.pdf", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) { res.status(404).json({ error: "no such session" }); return; }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ab-report-"));
  const htmlPath = path.join(dir, "report.html");
  const pdfPath = path.join(dir, "report.pdf");
  try {
    await fs.writeFile(htmlPath, reportHtml(s.toReport(), { asset: ASSET, registryUrl: addrUrl(registryAddress()) }));
    await promisify(execFile)(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { timeout: 30_000 });
    const pdf = await fs.readFile(pdfPath);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `attachment; filename="agentbazaar-report-${s.id}.pdf"`);
    res.send(pdf);
  } catch (e: any) {
    res.status(501).json({ error: `pdf generation unavailable: ${e?.message}` });
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

app.use(express.static(path.join(here, "../../web")));

const port = Number(process.env.ORCHESTRATOR_PORT ?? 3000);
app.listen(port, () => console.log(`[orchestrator] http://localhost:${port}  mode=${PAY_MODE}  registry=${process.env.REGISTRY_ADDRESS ?? "(unset)"}`));
