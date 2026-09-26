/**
 * One small LLM layer for the whole app.
 * Provider is chosen by env: ANTHROPIC_API_KEY -> Claude, else OPENAI_API_KEY -> OpenAI, else MOCK.
 * structured(): returns an object matching a zod schema. text(): returns plain text.
 */
import "dotenv/config";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

export const MOCK = process.env.MOCK_LLM === "1";

/** Thrown when the model declines a request on safety grounds. */
export class RefusalError extends Error {
  constructor(message = "The model declined this request.") { super(message); this.name = "RefusalError"; }
}
export const PROVIDER: "anthropic" | "openai" | "mock" = MOCK ? "mock" : process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "mock";

const CLAUDE_MODEL = process.env.MODEL ?? "claude-opus-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;
const a = () => (anthropic ??= new Anthropic());
const o = () => (openai ??= new OpenAI());

export async function structured<T extends z.ZodTypeAny>(system: string, user: string, schema: T, name = "output"): Promise<z.infer<T>> {
  if (PROVIDER === "anthropic") {
    const res = await a().messages.parse({
      model: CLAUDE_MODEL, max_tokens: 2000, system,
      output_config: { format: zodOutputFormat(schema), effort: "low" },
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") throw new RefusalError();
    if (!res.parsed_output) throw new Error("model returned no parsable output");
    return res.parsed_output;
  }
  if (PROVIDER === "openai") {
    const res = await o().chat.completions.parse({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: zodResponseFormat(schema, name),
    });
    const msg = res.choices[0]?.message;
    if (msg?.refusal) throw new RefusalError(msg.refusal);
    const parsed = msg?.parsed;
    if (!parsed) throw new Error("model returned no parsable output");
    return parsed as z.infer<T>;
  }
  throw new Error("no LLM provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY, or MOCK_LLM=1)");
}

export async function text(system: string, user: string): Promise<string> {
  if (PROVIDER === "anthropic") {
    const res = await a().messages.create({
      model: CLAUDE_MODEL, max_tokens: 2500, system, output_config: { effort: "low" },
      messages: [{ role: "user", content: user }],
    });
    return res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }
  if (PROVIDER === "openai") {
    const res = await o().chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    return res.choices[0]?.message?.content ?? "";
  }
  throw new Error("no LLM provider configured");
}
