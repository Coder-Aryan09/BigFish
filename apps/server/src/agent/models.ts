// BigFish agent: models. The graph only sees the AgentModels interface, so
// tests can script every model answer. The real one is Mistral.
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatMistralAI } from "@langchain/mistralai";
import { z } from "zod";
import { FINALIZE_PROMPT, JUDGE_PROMPT, PLANNER_PROMPT } from "./prompts.js";

export const PlanSchema = z.object({
  subtasks: z
    .array(
      z.object({
        goal: z.string().describe("One concrete thing to do in the browser."),
        criteria: z.string().describe("What must be visible on the page, or known, when the goal is met."),
      }),
    )
    .min(1)
    .max(6),
});
export type PlanOutput = z.infer<typeof PlanSchema>;

export const VerdictSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export interface ActModel {
  invoke(messages: BaseMessage[], options: { signal: AbortSignal }): Promise<AIMessage>;
}

export interface AgentModels {
  plan(input: { task: string; tabs: string }, signal: AbortSignal): Promise<PlanOutput>;
  // A model with these tools bound, used for the tool loop of one subtask.
  act(tools: StructuredToolInterface[]): ActModel;
  judge(input: string, signal: AbortSignal): Promise<Verdict>;
  finalize(input: string, signal: AbortSignal): Promise<string>;
}

export interface MistralConfig {
  apiKey: string;
  model: string;
  judgeModel: string;
}

// Undefined when MISTRAL_API_KEY is missing: the agent routes answer 503.
export function mistralConfigFromEnv(env: NodeJS.ProcessEnv): MistralConfig | undefined {
  const apiKey = env.MISTRAL_API_KEY;
  if (!apiKey || apiKey === "REPLACE_ME") return undefined;
  return {
    apiKey,
    model: env.AGENT_MODEL || "mistral-medium-latest",
    judgeModel: env.AGENT_JUDGE_MODEL || "mistral-small-latest",
  };
}

export function mistralModels(config: MistralConfig): AgentModels {
  const main = new ChatMistralAI({ apiKey: config.apiKey, model: config.model, temperature: 0, maxRetries: 2 });
  const cheap = new ChatMistralAI({ apiKey: config.apiKey, model: config.judgeModel, temperature: 0, maxRetries: 2 });
  const planner = main.withStructuredOutput(PlanSchema, { name: "plan" });
  const judge = cheap.withStructuredOutput(VerdictSchema, { name: "verdict" });

  return {
    plan: ({ task, tabs }, signal) =>
      planner.invoke([new SystemMessage(PLANNER_PROMPT), new HumanMessage(`Open tabs:\n${tabs}\n\nTask:\n${task}`)], { signal }),
    act: (tools) => {
      const bound = main.bindTools(tools);
      return { invoke: (messages, { signal }) => bound.invoke(messages, { signal }) };
    },
    judge: (input, signal) => judge.invoke([new SystemMessage(JUDGE_PROMPT), new HumanMessage(input)], { signal }),
    finalize: async (input, signal) => {
      const reply = await main.invoke([new SystemMessage(FINALIZE_PROMPT), new HumanMessage(input)], { signal });
      return typeof reply.content === "string" ? reply.content : reply.text;
    },
  };
}
