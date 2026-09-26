import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { listAgents as realListAgents, rateJob as realRateJob, type AgentListing } from "../shared/registry.js";
import { txUrl, usdc, toBase, PAY_MODE } from "../shared/config.js";
import { planQuestion, judgeResult, writeReport, chooseAgent, type PlanT } from "./brain.js";
import { pay as realPay, callWithProof as realCall, callPaidX402 as realX402, type PaymentProof, type AgentResultT } from "./payment.js";

export type Event = { type: string; ts: number; [k: string]: any };
export interface Receipt { agentId: number; agent: string; amount: string; txHash: Hex; paymentRef: Hex | null; url: string; delivered: boolean }
export interface Rating { agentId: number; agent: string; score: number; justification: string; txHash: Hex; url: string }

/** Everything that touches the chain, the network, or an LLM, so tests can swap it out. */
export interface SessionDeps {
  listAgents: () => Promise<AgentListing[]>;
  pay: (agentId: number, payTo: Hex, price: bigint) => Promise<PaymentProof>;
  call: (endpoint: string, proof: PaymentProof, task: string, context: string) => Promise<AgentResultT>;
  x402: (endpoint: string, task: string, context: string) => Promise<{ proof: PaymentProof; result: AgentResultT }>;
  rate: (paymentRef: Hex, score: number) => Promise<Hex>;
  plan: typeof planQuestion;
  judge: typeof judgeResult;
  report: typeof writeReport;
  payMode: "avax" | "direct" | "x402";
}
export const realDeps: SessionDeps = {
  listAgents: realListAgents, pay: realPay, call: realCall, x402: realX402, rate: realRateJob,
  plan: planQuestion, judge: judgeResult, report: writeReport, payMode: PAY_MODE,
};

export class Session {
  id = randomUUID().slice(0, 8);
  createdAt = Date.now();
  status: "planned" | "running" | "done" | "error" = "planned";
  budget: bigint;
  spent = 0n;
  paidCalls = 0;
  events: Event[] = [];
  listeners = new Set<(e: Event) => void>();
  plan!: PlanT;
  assignments: { subtask: PlanT["subtasks"][number]; agent: AgentListing | null; reason: string }[] = [];
  receipts: Receipt[] = [];
  ratings: Rating[] = [];
  contributions: { agent: string; task: string; result: any }[] = [];
  report = "";
  static MAX_PAID_CALLS = 10;
  static MAX_ATTEMPTS_PER_SUBTASK = 2;

  constructor(public question: string, budgetHuman: number, private deps: SessionDeps = realDeps) {
    this.budget = toBase(budgetHuman);
  }

  emit(type: string, data: Record<string, any> = {}) {
    const e: Event = { type, ts: Date.now(), ...data };
    this.events.push(e);
    for (const l of this.listeners) l(e);
  }

  remaining() { return this.budget - this.spent; }
  estimate() { return this.assignments.reduce((s, a) => s + (a.agent?.pricePerCall ?? 0n), 0n); }

  async createPlan() {
    const agents = await this.deps.listAgents();
    const categories = [...new Set(agents.filter((a) => a.active).map((a) => a.category))];
    this.plan = await this.deps.plan(this.question, categories);
    let remaining = this.budget;
    for (const st of this.plan.subtasks) {
      const choice = chooseAgent(agents.filter((a) => a.category === st.category), remaining, new Set());
      this.assignments.push({ subtask: st, agent: choice?.pick ?? null, reason: choice?.reason ?? "no affordable agent in this category" });
      if (choice) remaining -= choice.pick.pricePerCall;
    }
    this.emit("plan_created", { plan: this.toPlanJson() });
  }

  toPlanJson() {
    return {
      question: this.question, budget: usdc(this.budget), estimated: usdc(this.estimate()), rationale: this.plan?.rationale,
      subtasks: this.assignments.map((a) => ({
        title: a.subtask.title, task: a.subtask.task, category: a.subtask.category,
        agentId: a.agent?.id ?? null, agent: a.agent?.name ?? null, price: a.agent ? usdc(a.agent.pricePerCall) : null, reason: a.reason,
      })),
    };
  }

  /** Hard budget check, enforced in code before every payment regardless of what the LLM proposed. */
  canPay(price: bigint) {
    if (this.paidCalls >= Session.MAX_PAID_CALLS) return { ok: false, why: "max paid calls per session reached" };
    if (price > this.remaining()) return { ok: false, why: `price ${usdc(price)} exceeds remaining ${usdc(this.remaining())}` };
    return { ok: true, why: "" };
  }

  /** Money moved: count it immediately and record the receipt, whatever happens next. */
  private recordPayment(agent: AgentListing, proof: PaymentProof, ms: number): Receipt {
    this.spent += agent.pricePerCall;
    this.paidCalls++;
    const receipt: Receipt = { agentId: agent.id, agent: agent.name, amount: usdc(agent.pricePerCall), txHash: proof.txHash, paymentRef: proof.paymentRef, url: txUrl(proof.txHash), delivered: false };
    this.receipts.push(receipt);
    this.emit("payment_settled", { ...receipt, ms });
    this.emit("budget_update", { spent: usdc(this.spent), remaining: usdc(this.remaining()) });
    return receipt;
  }

  private async submitRating(agent: AgentListing, proof: PaymentProof, score: number, justification: string) {
    let tx: Hex = "0x" as Hex;
    if (proof.paymentRef) {
      try { tx = await this.deps.rate(proof.paymentRef, score); }
      catch (e: any) { this.emit("error", { message: `rateJob failed: ${e?.message ?? e}` }); }
    } else {
      this.emit("error", { message: "rating skipped: this payment rail has no on-chain payment reference (use PAY_MODE=avax for bound ratings)" });
    }
    const rating: Rating = { agentId: agent.id, agent: agent.name, score, justification, txHash: tx, url: txUrl(tx) };
    this.ratings.push(rating);
    this.emit("rating_submitted", rating);
  }

  async run(opts: { budgetUsdc?: number; excludedAgentIds?: number[] } = {}) {
    if (this.status !== "planned") throw new Error(`session is already ${this.status}`);
    if (opts.budgetUsdc) this.budget = toBase(opts.budgetUsdc);
    const excluded = new Set(opts.excludedAgentIds ?? []);
    this.status = "running";
    this.emit("started", { budget: usdc(this.budget) });
    try {
      const agents = await this.deps.listAgents();
      for (const a of this.assignments) {
        const tried = new Set<number>(excluded);
        let attempts = 0;
        let success = false;
        while (attempts < Session.MAX_ATTEMPTS_PER_SUBTASK && !success) {
          attempts++;
          const choice = chooseAgent(agents.filter((x) => x.category === a.subtask.category), this.remaining(), tried);
          if (!choice) { this.emit("agent_failed", { subtask: a.subtask.title, reason: "no affordable agent left for this subtask", fallback: null }); break; }
          const agent = choice.pick;
          tried.add(agent.id);
          this.emit("agent_selected", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, price: usdc(agent.pricePerCall), rating: agent.jobsRated ? agent.avgRating.toFixed(2) : null, reasoning: choice.reason });

          const check = this.canPay(agent.pricePerCall);
          if (!check.ok) { this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: `budget guard: ${check.why}`, fallback: null }); break; }

          // ---- pay, then call. A settled payment is spent even if the call fails. ----
          const t0 = Date.now();
          let proof: PaymentProof | null = null;
          let result: AgentResultT | null = null;
          let callError: string | null = null;
          try {
            if (this.deps.payMode === "x402") {
              try {
                const out = await this.deps.x402(agent.endpoint, a.subtask.task, this.question);
                proof = out.proof; result = out.result;
              } catch (e: any) {
                if (e?.proof) { proof = e.proof; callError = e.message; } else throw e;
              }
            } else {
              proof = await this.deps.pay(agent.id, agent.payTo, agent.pricePerCall);
            }
          } catch (e: any) {
            this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: `payment failed: ${e?.message ?? e}`, fallback: "next best agent" });
            continue;
          }
          if (!proof) { this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: "no payment proof", fallback: "next best agent" }); continue; }
          const settled: PaymentProof = proof;
          const receipt = this.recordPayment(agent, settled, Date.now() - t0);

          if (!result && !callError) {
            try { result = await this.deps.call(agent.endpoint, settled, a.subtask.task, this.question); }
            catch (e: any) { callError = e?.message ?? String(e); }
          }

          if (!result) {
            this.emit("result_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: callError, txHash: settled.txHash });
            await this.submitRating(agent, settled, 1, `paid but no usable response: ${callError}`);
            await this.refreshAgents(agents);
            this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: `paid ${usdc(agent.pricePerCall)} but the call failed: ${callError}`, fallback: attempts < Session.MAX_ATTEMPTS_PER_SUBTASK ? "retrying with next best agent" : "giving up on this subtask" });
            continue;
          }
          receipt.delivered = true;
          this.emit("result_received", { agentId: agent.id, agent: agent.name, summary: result.summary, facts: result.facts, sources: result.sources, confidence: result.confidence });

          let verdict;
          try { verdict = await this.deps.judge(a.subtask.task, result); }
          catch (e: any) { verdict = { score: 1, justification: `judge unavailable: ${e?.message ?? e}` }; }
          await this.submitRating(agent, settled, verdict.score, verdict.justification);
          await this.refreshAgents(agents);

          if (verdict.score <= 2) {
            this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: `low quality (${verdict.score}/5): ${verdict.justification}`, fallback: attempts < Session.MAX_ATTEMPTS_PER_SUBTASK ? "retrying with next best agent" : "giving up on this subtask" });
            continue;
          }
          this.contributions.push({ agent: agent.name, task: a.subtask.task, result });
          success = true;
        }
      }
      this.emit("composing_report", {});
      this.report = this.contributions.length ? await this.deps.report(this.question, this.contributions) : "No usable results were purchased within the budget.";
      this.status = "done";
      this.emit("report_ready", { spent: usdc(this.spent), remaining: usdc(this.remaining()) });
    } catch (e: any) {
      this.status = "error";
      this.emit("error", { message: e?.message ?? String(e) });
    }
  }

  private async refreshAgents(agents: AgentListing[]) {
    try { const fresh = await this.deps.listAgents(); agents.splice(0, agents.length, ...fresh); } catch {}
  }

  toReport() {
    return {
      id: this.id, status: this.status, question: this.question,
      budget: usdc(this.budget), spent: usdc(this.spent), remaining: usdc(this.remaining()),
      report: this.report, receipts: this.receipts, ratings: this.ratings,
      contributors: [...new Set(this.contributions.map((c) => c.agent))],
    };
  }
}
