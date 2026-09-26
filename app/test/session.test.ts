import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { Session, type SessionDeps } from "../src/orchestrator/session.js";
import type { AgentListing } from "../src/shared/registry.js";

const A = (id: number, name: string, category: string, priceAvax: string, jobs = 0, sum = 0): AgentListing => ({
  id, name, category, owner: "0x1", payTo: "0x2" as Hex, endpoint: `http://agent-${id}`, pricePerCall: BigInt(Math.round(+priceAvax * 1e18)),
  active: true, jobsRated: jobs, ratingSum: sum, avgRating: jobs ? sum / jobs : 0,
});
const good = { summary: "Specific answer", facts: ["f1", "f2"], sources: ["s1", "s2"], confidence: 0.9 };

function deps(over: Partial<SessionDeps> & { agents?: AgentListing[] } = {}): SessionDeps & { paid: string[]; rated: { ref: string; score: number }[]; calls: string[] } {
  const agents = over.agents ?? [A(0, "News", "news", "0.002"), A(1, "Chain", "onchain", "0.005"), A(2, "Budget", "news", "0.0005")];
  const d = {
    paid: [] as string[], rated: [] as { ref: string; score: number }[], calls: [] as string[],
    listAgents: async () => agents.map((a) => ({ ...a })),
    pay: async (id: number) => { const n = d.paid.length; d.paid.push(`agent${id}`); return { txHash: `0x${String(n).padStart(64, "0")}` as Hex, paymentRef: `0xref${n}` as Hex }; },
    call: async (endpoint: string) => { d.calls.push(endpoint); return good; },
    x402: async () => { throw new Error("not used"); },
    rate: async (ref: Hex, score: number) => { d.rated.push({ ref, score }); return "0xrated" as Hex; },
    plan: async (q: string, cats: string[]) => ({ allowed: true, refusal_reason: "", rationale: "t", subtasks: cats.map((c) => ({ title: c, task: `do ${c}`, category: c })) }),
    judge: async (_t: string, r: any) => (r.sources?.length ? { score: 5, justification: "ok" } : { score: 1, justification: "no sources" }),
    report: async () => "# report",
    payMode: "avax" as const,
    ...over,
  };
  return d;
}

test("paid request followed by endpoint failure is still counted as spent and rated 1", async () => {
  let n = 0;
  const d = deps({ call: async (endpoint) => { if (++n === 1) throw new Error("boom"); return good; } });
  const s = new Session("q", 0.05, d);
  await s.createPlan(); await s.run();
  const settled = s.events.filter((e) => e.type === "payment_settled");
  const failed = s.events.filter((e) => e.type === "result_failed");
  assert.equal(failed.length, 1, "one failed delivery");
  assert.ok(settled.length >= 2, "payment recorded even for the failed call");
  assert.equal(s.receipts.filter((r) => !r.delivered).length, 1, "undelivered receipt kept");
  assert.equal(s.spent, s.receipts.reduce((t, r) => t + BigInt(Math.round(+r.amount * 1e18)), 0n), "spent equals sum of receipts");
  assert.ok(d.rated.some((r) => r.score === 1), "failed agent rated 1 on chain");
  assert.equal(s.status, "done");
});

test("retry never exceeds the budget", async () => {
  // Budget only covers the cheap Budget agent (0.0005) plus nothing else useful for 'news'.
  const d = deps({ agents: [A(0, "News", "news", "0.002"), A(2, "Budget", "news", "0.0005")], judge: async () => ({ score: 1, justification: "bad" }) });
  const s = new Session("q", 0.002, d); // enough for Budget (0.0005) then News (0.002)? 0.0005 + 0.002 > 0.002, so retry must be refused
  await s.createPlan(); await s.run();
  assert.ok(s.spent <= s.budget, "spent within budget");
  const guard = s.events.find((e) => e.type === "agent_failed" && /budget guard|no affordable agent/.test(e.reason));
  assert.ok(guard, "budget guard blocked the retry");
});

test("planner cannot make the session overspend: max paid calls cap", async () => {
  const many = Array.from({ length: 30 }, (_, i) => A(i, `N${i}`, "news", "0.0001"));
  const d = deps({ agents: many, plan: async () => ({ allowed: true, refusal_reason: "", rationale: "", subtasks: Array.from({ length: 4 }, (_, i) => ({ title: `t${i}`, task: "x", category: "news" })) }), judge: async () => ({ score: 1, justification: "bad" }) });
  const s = new Session("q", 1, d);
  await s.createPlan(); await s.run();
  assert.ok(s.paidCalls <= Session.MAX_PAID_CALLS);
});

test("malformed agent response is treated as a failed delivery", async () => {
  const { parseResult } = await import("../src/orchestrator/payment.js");
  assert.throws(() => parseResult({ hello: "world" }), /malformed agent response/);
  assert.throws(() => parseResult({ summary: "", facts: "no", sources: [] }), /malformed/);
  assert.ok(parseResult(good));
  const d = deps({ call: async () => { throw new Error("malformed agent response: summary Required"); } });
  const s = new Session("q", 0.05, d);
  await s.createPlan(); await s.run();
  assert.ok(s.events.some((e) => e.type === "result_failed" && /malformed/.test(e.reason)));
  assert.equal(s.contributions.length, 0);
});

test("second approval of the same session is rejected", async () => {
  const d = deps();
  const s = new Session("q", 0.05, d);
  await s.createPlan();
  const first = s.run();
  await assert.rejects(() => s.run(), /already running/);
  await first;
  assert.equal(s.status, "done");
  assert.equal(d.paid.length, s.receipts.length, "no duplicate payments from a double approve");
});

test("orchestrator avoids an agent with a bad on-chain rating", async () => {
  const d = deps({ agents: [A(0, "News", "news", "0.002", 3, 15), A(2, "Budget", "news", "0.0005", 2, 3)] });
  const s = new Session("q", 0.05, d);
  await s.createPlan();
  assert.equal(s.assignments[0].agent?.name, "News");
  assert.match(s.assignments[0].reason, /Skipped Budget/);
});

test("x402 rail: missing settlement header means no payment and no receipt", async () => {
  const d = deps({ payMode: "x402", x402: async () => { throw new Error("agent answered without an x402 settlement header; no payment was made"); } });
  const s = new Session("q", 0.05, d);
  await s.createPlan(); await s.run();
  assert.equal(s.receipts.length, 0);
  assert.equal(s.spent, 0n);
  assert.ok(s.events.some((e) => e.type === "agent_failed" && /settlement header/.test(e.reason)));
});
