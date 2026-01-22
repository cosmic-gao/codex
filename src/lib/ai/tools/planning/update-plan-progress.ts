import { tool as createTool } from "ai";
import { z } from "zod";

import { PlanActionSchema } from "app-types/plan";

export const UpdatePlanProgressInputSchema = z.object({
  planId: z
    .string()
    .describe(
      "Plan identifier. Use the toolCallId of the plan tool call that created the plan.",
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
    .array(PlanActionSchema)
    .optional()
    .describe("Execution results or details generated during this step."),
  currentStepIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Optionally set the current executing step index (0-based)."),
});

export type UpdatePlanProgressInput = z.infer<typeof UpdatePlanProgressInputSchema>;

export const updatePlanProgressTool = createTool({
  description:
    "Update the execution progress of a previously generated plan. Use this to mark steps as in progress, completed, or failed.",
  inputSchema: UpdatePlanProgressInputSchema,
  execute: async () => {
    return "Success";
  },
});

