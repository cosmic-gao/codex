/**
 * Plan mode prompts
 *
 * @description
 * Centralized prompt templates for plan mode operations.
 * Supports variable substitution and versioning.
 */

export interface PromptVariables {
  planId?: string;
  planJson?: string;
  maxSteps?: number;
}

/**
 * Prompt for outline generation phase
 * 
 * Inspired by Cursor and LangChain TODO planning patterns
 */
export const OUTLINE_GENERATION_PROMPT = `
# Role: Task Decomposition Agent

You are a planning agent. Break down the user's request into a structured plan.
Call the \`outline\` tool with your plan, then STOP. Do NOT execute any steps.

## Output Schema
\`\`\`typescript
{
  title: string;           // Concise plan name
  description: string;     // Goal summary
  steps: [                 // 3-10 atomic steps
    {
      title: string;              // Action-oriented (1-5 words)
      description: string;        // Detailed instruction
      dependsOn?: number[];       // Prerequisite step indices (0-based)
      complexity?: "1"|"2"|"3";   // 1=Simple, 2=Moderate, 3=Complex
      estimatedDuration?: number; // Estimated seconds
    }
  ]
}
\`\`\`

## Planning Principles
1. **Atomic**: One clear objective per step.
2. **Sequential**: Logical execution order.
3. **Dependencies**: Explicitly mark prerequisites.
4. **Verbs**: Start titles with action verbs (e.g., Analyze, Create, Build).
5. **No Ambiguity**: Avoid vague terms like "process" or "handle".
6. **Verifiable**: Each step must have a clear, distinct output artifact.

## ⚠️ IMPORTANT: Plan Creation Phase Only
- You are ONLY creating the plan structure
- You will NOT execute any steps
- The system will automatically execute each step sequentially
- Step progress will be tracked automatically by the system
- Do NOT include status management or progress updates in your plan

## Example
\`\`\`json
{
  "title": "Research AI Frameworks",
  "description": "Compare top AI frameworks",
  "steps": [
    {
      "title": "Search Frameworks",
      "description": "Find top 5 AI frameworks in 2026",
      "complexity": "1",
      "estimatedDuration": 30
    },
    {
      "title": "Compare Features",
      "description": "Analyze pros/cons of each framework",
      "dependsOn": [0],
      "complexity": "2",
      "estimatedDuration": 90
    }
  ]
}
\`\`\`

Call \`outline\` now.
`.trim();


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


/**
 * Validation rules for outline quality
 */
export const OUTLINE_VALIDATION_RULES = {
  minSteps: 2,
  maxSteps: 15,
  minTitleLength: 2,
  maxTitleLength: 50,
  minDescriptionLength: 5,
  maxDescriptionLength: 200,
};

/**
 * Validate outline quality
 *
 * @param outline - Outline to validate
 * @returns Validation result with errors
 */
export function validateOutline(outline: {
  title?: string;
  description?: string;
  steps?: Array<{
    title?: string;
    description?: string;
    dependsOn?: number[];
  }>;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!outline.title || outline.title.length < OUTLINE_VALIDATION_RULES.minTitleLength) {
    errors.push("Outline title is missing or too short");
  }

  if (!outline.steps || outline.steps.length < OUTLINE_VALIDATION_RULES.minSteps) {
    errors.push(`Outline must have at least ${OUTLINE_VALIDATION_RULES.minSteps} steps`);
  }

  if (outline.steps && outline.steps.length > OUTLINE_VALIDATION_RULES.maxSteps) {
    errors.push(`Outline cannot have more than ${OUTLINE_VALIDATION_RULES.maxSteps} steps`);
  }

  outline.steps?.forEach((step, index) => {
    if (!step.title || step.title.length < OUTLINE_VALIDATION_RULES.minTitleLength) {
      errors.push(`Step ${index + 1}: title is missing or too short`);
    }

    if (step.title && step.title.length > OUTLINE_VALIDATION_RULES.maxTitleLength) {
      errors.push(`Step ${index + 1}: title is too long`);
    }

    // Validate dependencies
    if (step.dependsOn) {
      step.dependsOn.forEach((dep) => {
        if (dep >= index) {
          errors.push(`Step ${index + 1}: cannot depend on step ${dep + 1} (must depend on earlier steps)`);
        }
        if (dep < 0 || (outline.steps && dep >= outline.steps.length)) {
          errors.push(`Step ${index + 1}: invalid dependency index ${dep}`);
        }
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
