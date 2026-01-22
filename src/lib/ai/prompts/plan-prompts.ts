/**
 * Plan mode prompts
 *
 * @description
 * Centralized prompt templates for plan mode operations.
 * Supports variable substitution and versioning.
 */

export interface PromptVariables {
  outlineId?: string;
  planId?: string;
  outlineJson?: string;
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
 * Prompt for outline-based execution phase
 * 
 * Inspired by Cursor's step-by-step execution model
 */
export function buildOutlineExecutionPrompt(
  outlineId: string,
  outlineJson: string,
): string {
  return `
# Role: Task Execution Agent

Execute the plan step-by-step. The user is watching real-time progress.

<outline id="${outlineId}">
${outlineJson}
</outline>

## Execution Protocol
Execute ONE step at a time. Follow this cycle EXACTLY:

1. **Start**: Call \`progress({ planId: "${outlineId}", stepIndex: N, status: "in_progress", currentStepIndex: N })\`
2. **Work**: Perform the task (output content, call tools).
3. **Finish**: Call \`progress({ planId: "${outlineId}", stepIndex: N, status: "completed", currentStepIndex: N + 1 })\`

## Critical Rules
- **Sequential**: Finish Step N fully BEFORE starting Step N+1.
- **One by One**: NEVER start multiple steps at once.
- **Mandatory Progress**: Call \`progress\` at start and end of EACH step.
- **Real-time Output**: Output content/tool calls between progress updates.
- **Failures**: If a step fails, call \`progress({ ..., status: "failed", actions: [{ label: "error", value: "reason" }] })\` and STOP.

## Example Flow
\`\`\`
[STEP 0]
→ progress(..., status: "in_progress", ...)
[...Work/Output...]
→ progress(..., status: "completed", ...)

[STEP 1]
→ progress(..., status: "in_progress", ...)
[...Work/Output...]
→ progress(..., status: "completed", ...)
\`\`\`

Begin with Step 0 now.
`.trim();
}

/**
 * Prompt for plan generation phase (legacy)
 * 
 * Simpler version for backward compatibility
 */
export const PLAN_GENERATION_PROMPT = `
# Role: Task Planner

Create a structured task breakdown. Call \`plan\` tool, then STOP.

## Output Schema
- **title**: Concise name
- **description**: Goal summary
- **steps**: Array of objects:
  - \`title\`: Action verb + object (1-5 words)
  - \`description\`: Instruction
  - (No \`actions\` field)

## Rules
1. No execution during planning.
2. Atomic, sequential steps.
3. Logical ordering.
`.trim();

/**
 * Prompt for plan-based execution phase (legacy)
 * 
 * Simpler version for backward compatibility
 */
export function buildPlanExecutionPrompt(
  planId: string,
  planJson: string,
): string {
  return `
# Role: Task Execution Agent

<plan id="${planId}">
${planJson}
</plan>

## Protocol
Execute ONE step at a time.
1. **Start**: \`progress({ planId: "${planId}", stepIndex: N, status: "in_progress", currentStepIndex: N })\`
2. **Work**: Do the task.
3. **Finish**: \`progress({ planId: "${planId}", stepIndex: N, status: "completed", currentStepIndex: N + 1 })\`

## Rules
- Finish Step N fully before starting Step N+1.
- Mandatory progress calls before/after each step.
- No parallel execution.
- If failed: \`progress({ ..., status: "failed" })\` and STOP.

Start with Step 0.
`.trim();
}

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
