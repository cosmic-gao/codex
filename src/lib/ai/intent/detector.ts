import { generateText, tool as createTool } from "ai";
import { z } from "zod";
import { LanguageModel } from "ai";
import {
  DEFAULT_PLAN_CONFIG,
  hasExplicitTrigger,
  calculateComplexity,
  type PlanModeConfig,
} from "./config";

/**
 * Detect user intent for complex planning
 *
 * @description
 * Analyzes the user's message to determine if it requires a complex, multi-step execution plan.
 * Uses a two-stage approach:
 * 1. Fast keyword-based detection for explicit triggers
 * 2. AI-based analysis for implicit complexity
 *
 * @param {LanguageModel} model - The language model instance to use for classification
 * @param {string} message - The user's latest message content
 * @param {object} options - Optional configuration
 * @param {string[]} options.conversationHistory - Previous messages for context
 * @param {PlanModeConfig} options.config - Plan mode configuration
 * @returns {Promise<boolean>} - True if plan mode is required, false otherwise
 *
 * @example
 * const isPlan = await detectIntent(model, "Research React hooks and write a summary");
 * // returns true
 *
 * @example
 * const isPlan = await detectIntent(model, "Create a plan to migrate our app", {
 *   conversationHistory: ["What's the best way to migrate?", "We're using React 16"]
 * });
 * // returns true (explicit trigger: "create a plan")
 */
export async function detectIntent(
  model: LanguageModel,
  message: string,
  options?: {
    conversationHistory?: string[];
    config?: PlanModeConfig;
  },
): Promise<boolean> {
  const config = options?.config ?? DEFAULT_PLAN_CONFIG;

  // Early return if auto-detection is disabled
  if (!config.autoDetect) {
    return false;
  }

  // Stage 1: Fast keyword-based detection
  if (hasExplicitTrigger(message, config)) {
    return true;
  }

  // Stage 2: Complexity scoring
  const complexityScore = calculateComplexity(message, config);
  if (complexityScore >= config.sensitivity) {
    return true;
  }

  // Stage 3: AI-based analysis for borderline cases
  // Only invoke AI if complexity is moderate (0.4-0.7 range)
  if (complexityScore < 0.4) {
    return false;
  }

  let isComplexTask = false;

  // Build context from conversation history
  const contextPrompt = options?.conversationHistory?.length
    ? `\n\nConversation context (recent messages):\n${options.conversationHistory.slice(-3).join("\n")}`
    : "";

  await generateText({
    model,
    tools: {
      detectComplexTask: createTool({
        description: "Report whether the task requires complex planning.",
        inputSchema: z.object({
          isComplexTask: z
            .boolean()
            .describe("True if the task requires a multi-step plan."),
          confidence: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("Confidence score for the decision (0-1)"),
        }),
        execute: async ({ isComplexTask: result }) => {
          isComplexTask = result;
          return "Detected intent successfully";
        },
      }),
    },
    toolChoice: "required",
    messages: [
      {
        role: "system",
        content: `Analyze the user's request to determine if it requires a structured, multi-step execution plan.${contextPrompt}

Call the 'detectComplexTask' tool with your analysis.

Set isComplexTask to TRUE if the task:
1. Requires multiple sequential operations (e.g., "search X, then analyze Y, then write Z")
2. Involves coordination between different tools or systems
3. Has clear dependencies between steps (step B depends on step A's output)
4. Would benefit from showing progress through distinct phases
5. Is a complex workflow (e.g., "migrate database", "refactor codebase", "research and compare")

Examples requiring plan mode:
- "Research the top 5 AI frameworks, compare them, and write a summary"
- "Find all TODO comments in the code, categorize them, and create a report"
- "Search for React best practices, then refactor our components accordingly"
- "帮我研究 Vue 3 的新特性，然后写一份迁移指南"

Set isComplexTask to FALSE if the task:
1. Is a simple question or information request
2. Can be completed in a single operation
3. Is a straightforward code generation task
4. Is conversational or exploratory

Examples NOT requiring plan mode:
- "What is React?"
- "Search for Python tutorials"
- "Create a login component"
- "Fix the bug in auth.ts"
- "Hello, how are you?"

Provide a confidence score (0-1) for your decision.`,
      },
      { role: "user", content: message },
    ],
  });

  return isComplexTask;
}
