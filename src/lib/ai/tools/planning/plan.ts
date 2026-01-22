import { tool as createTool } from "ai";
import { PlanToolOutputSchema } from "app-types/plan";

export const planTool = createTool({
  description:
    "Create a structured execution plan with title, optional description, and ordered steps.",
  inputSchema: PlanToolOutputSchema,
  execute: async () => {
    return "Success";
  },
});

