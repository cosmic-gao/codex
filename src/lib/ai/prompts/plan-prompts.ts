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
 */
export const OUTLINE_GENERATION_PROMPT = `
你必须先调用 outline 工具输出完整的大纲步骤列表，然后停止。

要求：
1. 不要在生成大纲的同时执行任何步骤
2. 大纲包含：title（计划标题）、description（计划描述）、steps（步骤列表）
3. 每个步骤包含：
   - title：简洁的步骤名称（1-5个词）
   - description：步骤的详细说明
   - dependsOn：依赖的前置步骤索引（可选，数组，0-based）
   - complexity：复杂度评分（"1"=简单，"2"=中等，"3"=复杂）
   - estimatedDuration：预估耗时（秒）

4. 步骤设计原则：
   - 将任务分解为 3-10 个清晰的步骤
   - 每个步骤应该是原子性的、可独立执行的
   - 明确标注步骤间的依赖关系
   - 合理评估每个步骤的复杂度和耗时

示例大纲：
{
  "title": "研究并对比 AI 框架",
  "description": "全面分析主流 AI 框架并生成对比报告",
  "steps": [
    {
      "title": "搜索 AI 框架",
      "description": "查找 2026 年最流行的 5 个 AI 框架",
      "complexity": "1",
      "estimatedDuration": 30
    },
    {
      "title": "分析框架特性",
      "description": "收集每个框架的功能、性能、社区数据",
      "dependsOn": [0],
      "complexity": "2",
      "estimatedDuration": 60
    },
    {
      "title": "生成对比表格",
      "description": "创建结构化的框架对比表",
      "dependsOn": [1],
      "complexity": "2",
      "estimatedDuration": 45
    }
  ]
}
`.trim();

/**
 * Prompt for outline-based execution phase
 */
export function buildOutlineExecutionPrompt(
  outlineId: string,
  outlineJson: string,
): string {
  return `
<outline id="${outlineId}">
${outlineJson}
</outline>

现在开始按该大纲逐步执行：

执行规则：
1. 严格按 steps 的顺序执行（从索引 0 到最后）
2. 每步开始前调用 progress 工具：
   { planId: "${outlineId}", stepIndex: i, status: "in_progress", currentStepIndex: i }
3. 每步结束后调用 progress 工具：
   { planId: "${outlineId}", stepIndex: i, status: "completed", currentStepIndex: i+1 }
4. 每个步骤必须调用相应的工具来产出实际内容（如搜索、HTTP 请求、代码执行、工作流等）
5. 工具的输出会自动关联到当前步骤，作为步骤的详细结果
6. 如果某步失败，调用 progress 工具标记为 failed 并停止执行
7. 不要再次调用 outline 或 plan 工具
8. 不要修改大纲中的步骤内容，只更新执行进度

注意事项：
- 遵循 dependsOn 依赖关系，确保前置步骤完成后再执行
- 根据 complexity 合理分配精力（复杂步骤可能需要多次工具调用）
- 每个步骤都应该有明确的输出结果
`.trim();
}

/**
 * Prompt for plan generation phase (legacy)
 */
export const PLAN_GENERATION_PROMPT = `
你必须先调用 plan 工具输出完整的步骤列表，然后停止。

要求：
1. 不要在生成计划的同时执行任何步骤
2. 在 plan 工具中，只生成 title 和 description，不要生成 actions
3. 步骤应该清晰、可执行、有逻辑顺序
`.trim();

/**
 * Prompt for plan-based execution phase (legacy)
 */
export function buildPlanExecutionPrompt(
  planId: string,
  planJson: string,
): string {
  return `
<plan id="${planId}">
${planJson}
</plan>

现在开始执行该计划：
- 严格按 steps 的顺序执行（从 0 到最后）
- 每步开始前调用 progress：{ planId: "${planId}", stepIndex: i, status: "in_progress", currentStepIndex: i }
- 每步完成后调用 progress：{ planId: "${planId}", stepIndex: i, status: "completed", currentStepIndex: i+1 }
- 若失败调用 status: "failed" 并停止继续执行
- 不要再次调用 plan 工具，也不要改写 steps 内容，只更新进度
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
