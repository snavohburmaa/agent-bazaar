/** All Claude calls made by the orchestrator: planning, selection reasoning, judging, and report writing. */
import { z } from "zod";
import { usdc, ASSET } from "../shared/config.js";
import type { AgentListing } from "../shared/registry.js";
import { structured, text, MOCK, RefusalError } from "../shared/llm.js";

export const Plan = z.object({
  allowed: z.boolean().describe("false if the question asks for illegal, harmful, abusive, or hateful content, or is not a research request at all"),
  refusal_reason: z.string().describe("short, polite explanation shown to the user when allowed is false; empty string otherwise"),
  subtasks: z.array(
    z.object({
      title: z.string().describe("short label for the subtask"),
      task: z.string().describe("instruction to hand to the specialist agent"),
      category: z.string().describe("one of the available registry categories"),
    }),
  ).max(4),
  rationale: z.string(),
});
export type PlanT = z.infer<typeof Plan>;

export async function planQuestion(question: string, categories: string[]): Promise<PlanT> {
  if (MOCK) {
    const wanted = ["news", "onchain"].filter((c) => categories.includes(c));
    return { allowed: true, refusal_reason: "", rationale: "mock plan", subtasks: wanted.map((c) => ({ title: c === "news" ? "Recent developments" : "On-chain activity", task: `${c === "news" ? "Find recent developments" : "Examine on-chain activity"} for: ${question}`, category: c })) };
  }
  const plan = await structured(`You are a research orchestrator. First decide if the request is acceptable: refuse (allowed=false, empty subtasks) if it seeks illegal activity, harm to people, hate or harassment, scams or fraud, or is abusive rather than a research question. Otherwise set allowed=true and split the user's question into 2 or 3 subtasks. Each subtask must map to exactly one of these specialist categories: ${categories.join(", ")}. Use each category at most once. Keep tasks concrete and answerable in one call.`, question, Plan, "plan");
  if (!plan.allowed) throw new RefusalError(plan.refusal_reason || "This request cannot be researched.");
  if (!plan.subtasks.length) throw new Error("planner produced no subtasks");
  return plan;
}

export const Verdict = z.object({
  score: z.number().int().min(1).max(5),
  justification: z.string().describe("one sentence"),
});

export async function judgeResult(task: string, result: any): Promise<z.infer<typeof Verdict>> {
  if (MOCK) {
    const weak = !result?.sources?.length || !result?.facts?.length;
    return { score: weak ? 1 : 5, justification: weak ? "mock judge: no facts or sources" : "mock judge: specific and sourced" };
  }
  return structured(`You grade a specialist agent's answer for a paid research task. Rubric:
5 = specific, factual, at least 2 concrete facts and 2 sources, directly answers the task.
4 = mostly specific, minor gaps.
3 = generic but relevant, weak sourcing.
2 = vague, no facts or no sources.
1 = empty, off-topic, or a single vague sentence.
Be strict. Missing sources caps the score at 2.`, `Task: ${task}\n\nAnswer JSON:\n${JSON.stringify(result, null, 2)}`, Verdict, "verdict");
}

export async function writeReport(question: string, contributions: { agent: string; task: string; result: any }[]): Promise<string> {
  if (MOCK) return `# Mock report\n\n${contributions.map((c) => `## ${c.agent}\n${c.result?.summary ?? ""}`).join("\n\n")}\n\n**Conclusion:** mock mode, set ANTHROPIC_API_KEY for a real report.`;
  return text("Write a concise research report in Markdown (headings, short paragraphs, bullet lists). Attribute each finding to the agent that produced it, e.g. '(News Analyst)'. End with a 2-sentence conclusion that directly answers the question. Do not invent data not present in the contributions.", `Question: ${question}\n\nContributions:\n${JSON.stringify(contributions, null, 2)}`);
}

/** Deterministic selection (no LLM): rating first, then price. Avoids agents with a proven bad record. */
export function chooseAgent(candidates: AgentListing[], remainingBudget: bigint, exclude: Set<number>) {
  const ok = candidates.filter((a) => a.active && !exclude.has(a.id) && a.pricePerCall <= remainingBudget);
  const trusted = ok.filter((a) => !(a.jobsRated > 0 && a.avgRating < 2.5));
  const pool = trusted.length ? trusted : ok;
  pool.sort((a, b) => {
    const ra = a.jobsRated ? a.avgRating : 3; // unrated agents get a neutral prior
    const rb = b.jobsRated ? b.avgRating : 3;
    // value = rating per dollar, but never let a rating below 2.5 win on price alone
    const va = ra / Number(a.pricePerCall);
    const vb = rb / Number(b.pricePerCall);
    return vb - va;
  });
  const pick = pool[0];
  if (!pick) return null;
  const skipped = candidates.filter((a) => a.active && !exclude.has(a.id) && a.jobsRated > 0 && a.avgRating < 2.5 && a.id !== pick.id);
  const reason = [
    `${pick.name} chosen: ${pick.jobsRated ? `avg rating ${pick.avgRating.toFixed(2)} over ${pick.jobsRated} jobs` : "no ratings yet"}, price ${usdc(pick.pricePerCall)} ${ASSET}.`,
    skipped.length ? `Skipped ${skipped.map((s) => `${s.name} (rating ${s.avgRating.toFixed(2)})`).join(", ")} despite lower price.` : "",
  ].filter(Boolean).join(" ");
  return { pick, reason };
}
