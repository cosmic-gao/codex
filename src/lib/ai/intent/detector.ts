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
        content: `You are a task complexity analyzer. Determine if the user's request requires a structured, multi-step execution plan with progress tracking.${contextPrompt}

Call the 'detectComplexTask' tool with your analysis.

## Criteria for Plan Mode (isComplexTask = TRUE)

A task requires plan mode if it meets ANY of these conditions:

1. **Sequential Operations**: Multiple steps that must be done in order
   - "Research X, then analyze Y, then write Z"
   - "First gather data, then process it, finally generate a report"

2. **Multi-Tool Coordination**: Requires using different tools/systems together
   - "Search the web, read files, then compare findings"
   - "Query database, transform data, then visualize results"

3. **Clear Dependencies**: Later steps depend on earlier step outputs
   - "Find the top 5 options, compare them, choose the best one"
   - "Analyze code, identify issues, propose fixes"

4. **Complex Workflows**: Well-known multi-phase processes
   - "Migrate database", "refactor codebase", "conduct research study"
   - "Write a novel", "create a business plan", "design a system"

5. **Creative Projects**: Multi-chapter/multi-section content creation
   - "Write a short story with multiple chapters"
   - "Create a tutorial series with 5 lessons"
   - "Design a complete UI system"

## Examples Requiring Plan Mode

✅ "Research the top 5 AI frameworks, compare them, and write a summary"
✅ "Find all TODO comments in the code, categorize them, and create a report"
✅ "Search for React best practices, then refactor our components accordingly"
✅ "Write a fantasy novel about a wizard academy with world-building, characters, and plot"
✅ "Create a migration guide: research Vue 3 features, document changes, write examples"
✅ "Build a full-stack app: design database, create API, build frontend"
✅ "Analyze our codebase: find patterns, identify issues, suggest improvements"

## Criteria for Simple Mode (isComplexTask = FALSE)

A task does NOT need plan mode if it:

1. **Simple Question**: Just asking for information
2. **Single Operation**: Can be done in one step
3. **Straightforward Task**: No dependencies or sequencing needed
4. **Conversational**: Chat, greeting, or exploratory discussion
5. **Quick Generation**: Simple code/content without multiple phases

## Examples NOT Requiring Plan Mode

❌ "What is React?"
❌ "Search for Python tutorials"
❌ "Create a login component"
❌ "Fix the bug in auth.ts"
❌ "Hello, how are you?"
❌ "Explain how async/await works"
❌ "Generate a utility function for date formatting"
❌ "What's the weather like?"

## Decision Guidelines

- When in doubt, prefer FALSE (simple mode) for better UX
- Only use TRUE if the task clearly benefits from step-by-step progress tracking
- Consider: Would breaking this into visible steps help the user understand progress?
- Provide a confidence score (0-1) reflecting your certainty`,
      },
      { role: "user", content: message },
    ],
  });

  return isComplexTask;
}
