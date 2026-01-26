import { tool as createTool } from "ai";
import { PlanToolOutputSchema } from "app-types/plan";

/**
 * Prompt for plan generation phase (legacy)
 * 
 * Simpler version for backward compatibility
 */
export const PLAN_GENERATION_PROMPT = `
# Role: Task Planner

Create a structured execution plan. Call \`plan\` tool, then STOP.

## Output Schema
- **title**: Clear, high-level goal.
- **description**: Summary of the overall objective.
- **steps**: Array of objects (3-10 steps):
  - \`title\`: Action verb + object (e.g., "Analyze Codebase", "Refactor Component").
  - \`description\`: Clear definition of WHAT needs to be achieved in this step.
  - (No \`actions\` field - this is for execution phase)

## Planning Principles
1. **Atomic**: Each step must be a distinct unit of work.
2. **Sequential**: Steps must follow a logical execution order.
3. **Actionable**: Titles must be clear actions.
4. **Complete**: The plan must cover the entire user request.
5. **Verifiable**: Steps must produce visible results.

## ⚠️ IMPORTANT: Plan Creation Phase Only
- You are ONLY creating the plan structure
- You will NOT execute any steps yourself
- After you call \`plan\`, the system will automatically:
  1. Execute each step one by one
  2. Track progress and status for each step
  3. Handle transitions between steps
- Do NOT include status management or progress tracking in your plan
- Do NOT describe how to update status in step descriptions

## Example
\`\`\`json
{
  "title": "Refactor Login Component",
  "description": "Modernize the login form with new UI and validation",
  "steps": [
    {
      "title": "Analyze Existing Logic",
      "description": "Review current login.tsx and identify dependencies"
    },
    {
      "title": "Implement UI Changes",
      "description": "Update JSX structure and Tailwind classes"
    }
  ]
}
\`\`\`
`.trim();

export const planTool = createTool({
  description:
    "Create a structured execution plan with title, optional description, and ordered steps.",
  inputSchema: PlanToolOutputSchema,
  execute: async () => {
    return "Success";
  },
});
