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

## MANDATORY EXECUTION PROTOCOL

You MUST execute steps ONE AT A TIME in this exact sequence:

### For EACH Step (0, 1, 2, ...):

**Step N Cycle:**
\`\`\`
1. progress({ planId: "${outlineId}", stepIndex: N, status: "in_progress", currentStepIndex: N })
2. [PERFORM THE ACTUAL WORK - output content or call tools]
3. progress({ planId: "${outlineId}", stepIndex: N, status: "completed", currentStepIndex: N+1 })
\`\`\`

**CRITICAL**: Complete the ENTIRE cycle for Step N before starting Step N+1.

### Concrete Example (3 steps):

\`\`\`
STEP 0:
→ progress({ planId: "${outlineId}", stepIndex: 0, status: "in_progress", currentStepIndex: 0 })
→ [Output world building content here - the actual work]
→ progress({ planId: "${outlineId}", stepIndex: 0, status: "completed", currentStepIndex: 1 })

STEP 1:
→ progress({ planId: "${outlineId}", stepIndex: 1, status: "in_progress", currentStepIndex: 1 })
→ [Output character design content here - the actual work]
→ progress({ planId: "${outlineId}", stepIndex: 1, status: "completed", currentStepIndex: 2 })

STEP 2 (LAST):
→ progress({ planId: "${outlineId}", stepIndex: 2, status: "in_progress", currentStepIndex: 2 })
→ [Output plot outline content here - the actual work]
→ progress({ planId: "${outlineId}", stepIndex: 2, status: "completed" })
   ⚠️ NOTE: For the LAST step, omit currentStepIndex or set it to undefined
\`\`\`

## ABSOLUTE RULES (NON-NEGOTIABLE)

### ✅ YOU MUST:
1. Use EXACT planId: \`"${outlineId}"\` (never modify)
2. Execute steps in strict order: 0 → 1 → 2 → ...
3. Call \`progress\` TWICE per step (start + end)
4. Output actual content BETWEEN the two progress calls
5. Wait for step N to be marked "completed" before starting step N+1
6. For the LAST step only: omit \`currentStepIndex\` in the completed call

### ❌ YOU MUST NOT:
1. Skip any \`progress\` calls
2. Start step N+1 before completing step N
3. Output all content at once without progress calls
4. Call \`outline\` or \`plan\` tools again
5. Modify the outline structure
6. Execute multiple steps simultaneously

## Common Mistakes (AVOID THESE)

### ❌ WRONG: Missing progress calls
\`\`\`
[Output step 0]
[Output step 1]
[Output step 2]
\`\`\`

### ❌ WRONG: All at once
\`\`\`
progress(step 0, in_progress)
progress(step 1, in_progress)
progress(step 2, in_progress)
[Output everything]
\`\`\`

### ✅ CORRECT: One by one
\`\`\`
progress(step 0, in_progress)
[Output step 0]
progress(step 0, completed)
progress(step 1, in_progress)
[Output step 1]
progress(step 1, completed)
...
\`\`\`

## Why This Matters

The user sees REAL-TIME UI updates:
- 🔵 Blue highlight = step is in_progress
- 📝 Content appears = you output the work
- ✅ Green checkmark = step is completed

If you skip progress calls, the UI breaks and confuses the user.

## START NOW

Begin with Step 0:
1. Call: \`progress({ planId: "${outlineId}", stepIndex: 0, status: "in_progress", currentStepIndex: 0 })\`
2. Output the content for Step 0
3. Call: \`progress({ planId: "${outlineId}", stepIndex: 0, status: "completed", currentStepIndex: 1 })\`
4. Then proceed to Step 1

DO NOT START STEP 1 UNTIL STEP 0 IS COMPLETED.
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

## MANDATORY EXECUTION PROTOCOL

Execute ONE step at a time in this exact sequence:

### For EACH Step:
\`\`\`
1. progress({ planId: "${planId}", stepIndex: N, status: "in_progress", currentStepIndex: N })
2. [DO THE ACTUAL WORK]
3. progress({ planId: "${planId}", stepIndex: N, status: "completed", currentStepIndex: N+1 })
\`\`\`

### Example (3 steps):
\`\`\`
STEP 0:
→ progress({ planId: "${planId}", stepIndex: 0, status: "in_progress", currentStepIndex: 0 })
→ [Work for step 0]
→ progress({ planId: "${planId}", stepIndex: 0, status: "completed", currentStepIndex: 1 })

STEP 1:
→ progress({ planId: "${planId}", stepIndex: 1, status: "in_progress", currentStepIndex: 1 })
→ [Work for step 1]
→ progress({ planId: "${planId}", stepIndex: 1, status: "completed", currentStepIndex: 2 })

STEP 2 (LAST):
→ progress({ planId: "${planId}", stepIndex: 2, status: "in_progress", currentStepIndex: 2 })
→ [Work for step 2]
→ progress({ planId: "${planId}", stepIndex: 2, status: "completed" })
   ⚠️ For LAST step: omit currentStepIndex
\`\`\`

## RULES (NON-NEGOTIABLE)

✅ MUST:
- Use exact planId: \`"${planId}"\`
- Call \`progress\` before AND after each step
- Complete step N before starting step N+1
- For last step: omit \`currentStepIndex\` in completed call

❌ MUST NOT:
- Skip \`progress\` calls
- Start multiple steps at once
- Call \`plan\` tool again

## On Failure:
\`\`\`
progress({ planId: "${planId}", stepIndex: N, status: "failed", actions: [{ label: "error", value: "reason" }] })
\`\`\`
Then STOP.

Start with Step 0 now.
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
