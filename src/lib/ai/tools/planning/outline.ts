import { tool as createTool } from "ai";
import { OutlineToolOutputSchema } from "app-types/plan";

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
      priority?: "high"|"medium"|"low"; // Execution priority (default: medium)
      complexity?: "1"|"2"|"3";   // 1=Simple, 2=Moderate, 3=Complex
      estimatedDuration?: number; // Estimated seconds
    }
  ]
}

## Planning Principles
1. **Atomic**: One clear objective per step.
2. **Sequential**: Logical execution order.
3. **Prioritized**: Sort steps by priority (High -> Low) where possible, while respecting dependencies.
4. **Dependencies**: Explicitly mark prerequisites.
5. **Verbs**: Start titles with action verbs (e.g., Analyze, Create, Build).
6. **No Ambiguity**: Avoid vague terms like "process" or "handle".
7. **Verifiable**: Each step must have a clear, distinct output artifact.

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
