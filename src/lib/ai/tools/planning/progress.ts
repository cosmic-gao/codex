import { tool as createTool } from "ai";
import { z } from "zod";

export const ProgressInputSchema = z.object({
  planId: z
    .string()
    .describe(
      "Plan identifier. Use the toolCallId of the plan or outline tool call that created the plan.",
    ),
  stepIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Which step index to update (0-based)."),
  status: z
    .enum(["pending", "in_progress", "completed", "failed"])
    .optional()
    .describe("New status for the step."),
  actions: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().optional(),
      }),
    )
    .optional()
    .describe("Optional actions or tags associated with this step update."),
  currentStepIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Optionally set the current executing step index (0-based)."),
});

export type ProgressInput = z.infer<typeof ProgressInputSchema>;

export const progressTool = createTool({
  description:
    "Update the execution progress of a previously generated plan. Use this to mark steps as in progress, completed, or failed.",
  inputSchema: ProgressInputSchema,
  execute: async () => {
    return "Success";
  },
});

