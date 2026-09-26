import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { listAgents, rateJob, type AgentListing } from "../shared/registry.js";
import { txUrl, usdc, toBase } from "../shared/config.js";
import { planQuestion, judgeResult, writeReport, chooseAgent, type PlanT } from "./brain.js";
import { payAndCall } from "./payment.js";

export type Event = { type: string; ts: number; [k: string]: any };

export interface Receipt { agentId: number; agent: string; amount: string; txHash: Hex; url: string; }
export interface Rating { agentId: number; agent: string; score: number; justification: string; txHash: Hex; url: string; }

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

  constructor(public question: string, budgetUsdc: number) {
    this.budget = toBase(budgetUsdc);
  }

  emit(type: string, data: Record<string, any> = {}) {
    const e: Event = { type, ts: Date.now(), ...data };
    this.events.push(e);
    for (const l of this.listeners) l(e);
  }

  remaining() { return this.budget - this.spent; }

  estimate() {
    return this.assignments.reduce((s, a) => s + (a.agent?.pricePerCall ?? 0n), 0n);
  }

  async createPlan() {
    const agents = await listAgents();
    const categories = [...new Set(agents.filter((a) => a.active).map((a) => a.category))];
    this.plan = await planQuestion(this.question, categories);
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
      question: this.question,
      budget: usdc(this.budget),
      estimated: usdc(this.estimate()),
      rationale: this.plan?.rationale,
      subtasks: this.assignments.map((a) => ({
        title: a.subtask.title, task: a.subtask.task, category: a.subtask.category,
        agentId: a.agent?.id ?? null, agent: a.agent?.name ?? null, price: a.agent ? usdc(a.agent.pricePerCall) : null, reason: a.reason,
      })),
    };
  }

  /** Hard budget check, enforced in code before every payment regardless of what the LLM proposed. */
  private canPay(price: bigint) {
    if (this.paidCalls >= Session.MAX_PAID_CALLS) return { ok: false, why: "max paid calls per session reached" };
    if (price > this.remaining()) return { ok: false, why: `price ${usdc(price)} exceeds remaining ${usdc(this.remaining())}` };
    return { ok: true, why: "" };
  }

  async run(opts: { budgetUsdc?: number; excludedAgentIds?: number[] } = {}) {
    if (opts.budgetUsdc) this.budget = toBase(opts.budgetUsdc);
    const excluded = new Set(opts.excludedAgentIds ?? []);
    this.status = "running";
    this.emit("started", { budget: usdc(this.budget) });
    try {
      const agents = await listAgents();
      for (const a of this.assignments) {
        const tried = new Set<number>(excluded);
        let attempts = 0;
        let success = false;
        while (attempts < 2 && !success) {
          attempts++;
          const choice = chooseAgent(agents.filter((x) => x.category === a.subtask.category), this.remaining(), tried);
          if (!choice) { this.emit("agent_failed", { subtask: a.subtask.title, reason: "no affordable agent left for this subtask", fallback: null }); break; }
          const agent = choice.pick;
          tried.add(agent.id);
          this.emit("agent_selected", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, price: usdc(agent.pricePerCall), rating: agent.jobsRated ? agent.avgRating.toFixed(2) : null, reasoning: choice.reason });

          const check = this.canPay(agent.pricePerCall);
          if (!check.ok) { this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: `budget guard: ${check.why}`, fallback: null }); break; }

          let paid;
          try {
            paid = await payAndCall(agent.endpoint, agent.payTo, agent.pricePerCall, a.subtask.task, this.question, 45_000);
          } catch (e: any) {
            this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: e?.message ?? "call failed", fallback: "next best agent" });
            continue;
          }
          this.spent += agent.pricePerCall;
          this.paidCalls++;
          const receipt: Receipt = { agentId: agent.id, agent: agent.name, amount: usdc(agent.pricePerCall), txHash: paid.txHash, url: txUrl(paid.txHash) };
          this.receipts.push(receipt);
          this.emit("payment_settled", { ...receipt, ms: paid.ms });
          this.emit("budget_update", { spent: usdc(this.spent), remaining: usdc(this.remaining()) });
          this.emit("result_received", { agentId: agent.id, agent: agent.name, summary: paid.body?.summary ?? "", facts: paid.body?.facts ?? [], sources: paid.body?.sources ?? [], confidence: paid.body?.confidence });

          let verdict;
          try { verdict = await judgeResult(a.subtask.task, paid.body); }
          catch (e: any) { verdict = { score: 1, justification: `judge unavailable: ${e?.message ?? e}` }; }
          let ratingTx: Hex = "0x" as Hex;
          try {
            ratingTx = await rateJob(agent.id, verdict.score, paid.txHash);
          } catch (e: any) {
            this.emit("error", { message: `rateJob failed: ${e?.message}` });
          }
          const rating: Rating = { agentId: agent.id, agent: agent.name, score: verdict.score, justification: verdict.justification, txHash: ratingTx, url: txUrl(ratingTx) };
          this.ratings.push(rating);
          this.emit("rating_submitted", rating);
          // refresh the local view so the next selection sees the new rating
          const fresh = await listAgents();
          agents.splice(0, agents.length, ...fresh);

          if (verdict.score <= 2) {
            this.emit("agent_failed", { subtask: a.subtask.title, agentId: agent.id, agent: agent.name, reason: `low quality (${verdict.score}/5): ${verdict.justification}`, fallback: attempts < 2 ? "retrying with next best agent" : "giving up on this subtask" });
            continue;
          }
          this.contributions.push({ agent: agent.name, task: a.subtask.task, result: paid.body });
          success = true;
        }
      }
      this.emit("composing_report", {});
      this.report = this.contributions.length
        ? await writeReport(this.question, this.contributions)
        : "No usable results were purchased within the budget.";
      this.status = "done";
      this.emit("report_ready", { spent: usdc(this.spent), remaining: usdc(this.remaining()) });
    } catch (e: any) {
      this.status = "error";
      this.emit("error", { message: e?.message ?? String(e) });
    }
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
