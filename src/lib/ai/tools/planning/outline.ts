import { tool as createTool } from "ai";
import { OutlineToolOutputSchema } from "app-types/plan";

export const outlineTool = createTool({
  description:
    "Create a structured outline with title, optional description, and ordered steps. The outline must not include step execution details.",
  inputSchema: OutlineToolOutputSchema,
  execute: async () => {
    return "Success";
  },
});

