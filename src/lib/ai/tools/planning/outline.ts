import { tool as createTool } from "ai";
import { OutlineToolOutputSchema } from "app-types/plan";

/**
 * Outline tool for creating structured execution plans
 *
 * @description
 * Creates a high-level outline with clear steps, dependencies, and complexity scoring.
 * This tool is for planning only and does not execute actions.
 */
export const outlineTool = createTool({
  description: `Create a high-level outline for a complex task with clear, actionable steps.

Guidelines for creating effective outlines:
1. Break down the task into 3-10 clear, sequential steps
2. Each step should have a concise title (1-5 words) and brief description
3. Identify dependencies: if a step requires output from previous steps, specify dependsOn (array of step indices, 0-based)
4. Assign complexity: 1=simple (single tool call), 2=moderate (multiple operations), 3=complex (requires reasoning/iteration)
5. Estimate duration: approximate seconds needed for each step

Example outline structure:
{
  "title": "Research and Compare AI Frameworks",
  "description": "Comprehensive analysis of top AI frameworks with comparison report",
  "steps": [
    {
      "title": "Search AI Frameworks",
      "description": "Find top 5 AI frameworks in 2026",
      "complexity": "1",
      "estimatedDuration": 30
    },
    {
      "title": "Analyze Each Framework",
      "description": "Gather details on features, performance, community",
      "dependsOn": [0],
      "complexity": "2",
      "estimatedDuration": 60
    },
    {
      "title": "Create Comparison Table",
      "description": "Build structured comparison of all frameworks",
      "dependsOn": [1],
      "complexity": "2",
      "estimatedDuration": 45
    }
  ]
}

This tool is for planning only and does not execute actions.`,
  inputSchema: OutlineToolOutputSchema,
  execute: async () => {
    return "Success";
  },
});
