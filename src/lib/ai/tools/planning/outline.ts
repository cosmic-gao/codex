import { tool as createTool } from "ai";
import { OutlineToolOutputSchema } from "app-types/plan";

export const outlineTool = createTool({
  description:
    "Create a high-level outline for a task with a title, description, and a list of steps. This tool is for planning only and does not execute actions.",
  inputSchema: OutlineToolOutputSchema,
  execute: async () => {
    return "Success";
  },
});
