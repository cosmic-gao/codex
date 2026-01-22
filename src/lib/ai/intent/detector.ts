import { generateObject } from "ai";
import { z } from "zod";
import { LanguageModel } from "ai";

/**
 * Detect user intent for complex planning
 *
 * @description
 * Analyzes the user's latest message to determine if it requires a complex, multi-step execution plan.
 * Returns true if the task involves multiple tools, complex reasoning, or explicit request for a plan.
 *
 * @param {LanguageModel} model - The language model instance to use for classification
 * @param {string} message - The user's latest message content
 * @returns {Promise<boolean>} - True if plan mode is required, false otherwise
 *
 * @example
 * const isPlan = await detectIntent(model, "Research React hooks and write a summary");
 * // returns true
 */
export async function detectIntent(
  model: LanguageModel,
  message: string,
): Promise<boolean> {
  const { object } = await generateObject({
    model,
    schema: z.object({
      isComplexTask: z.boolean(),
    }),
    system: `Analyze the user's request. Does it require a complex, multi-step execution plan involving multiple tools (e.g. search then summarize, or multi-step coding)? 
    Return true ONLY if:
    1. The user explicitly asks for a plan/outline.
    2. The task clearly requires sequential steps (e.g. "Research X then write Y").
    3. The task is too complex for a single-shot answer.
    
    Return false for:
    1. Simple questions (e.g. "What is X?", "Hello").
    2. Single-step tasks (e.g. "Search for X").
    3. Code generation requests without explicit planning needs.`,
    prompt: message,
  });

  return object.isComplexTask;
}
