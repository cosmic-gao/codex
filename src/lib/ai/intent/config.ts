/**
 * Plan mode configuration
 *
 * @description
 * Centralized configuration for plan mode behavior, detection sensitivity,
 * and user preferences.
 */

export interface PlanModeConfig {
  /** Enable/disable automatic intent detection */
  autoDetect: boolean;
  /** Detection sensitivity threshold (0-1, higher = more sensitive) */
  sensitivity: number;
  /** Maximum steps allowed per plan */
  maxSteps: number;
  /** Timeout per step in milliseconds */
  stepTimeout: number;
  /** Keywords that explicitly trigger plan mode */
  explicitTriggers: {
    en: string[];
    zh: string[];
  };
  /** Tools that suggest complex tasks */
  complexityIndicators: string[];
}

export const DEFAULT_PLAN_CONFIG: PlanModeConfig = {
  autoDetect: true,
  sensitivity: 0.7,
  maxSteps: 15,
  stepTimeout: 120000, // 2 minutes
  explicitTriggers: {
    en: [
      "plan",
      "outline",
      "steps",
      "break down",
      "breakdown",
      "step by step",
      "multi-step",
      "multi step",
      "create a plan",
      "make a plan",
      "plan out",
    ],
    zh: [
      "计划",
      "规划",
      "步骤",
      "大纲",
      "分步",
      "逐步",
      "一步步",
      "分解",
      "拆解",
      "制定计划",
      "列出步骤",
    ],
  },
  complexityIndicators: [
    "then",
    "after",
    "next",
    "finally",
    "first",
    "second",
    "multiple",
    "several",
    "various",
    "different",
    "然后",
    "接着",
    "之后",
    "最后",
    "首先",
    "其次",
    "多个",
    "若干",
    "不同",
  ],
};

/**
 * Check if message contains explicit plan triggers
 *
 * @param message - User message to analyze
 * @param config - Plan mode configuration
 * @returns True if explicit triggers found
 */
export function hasExplicitTrigger(
  message: string,
  config: PlanModeConfig = DEFAULT_PLAN_CONFIG,
): boolean {
  const lowerMessage = message.toLowerCase();
  const allTriggers = [
    ...config.explicitTriggers.en,
    ...config.explicitTriggers.zh,
  ];

  return allTriggers.some((trigger) => lowerMessage.includes(trigger));
}

/**
 * Calculate complexity score based on message content
 *
 * @param message - User message to analyze
 * @param config - Plan mode configuration
 * @returns Complexity score (0-1)
 */
export function calculateComplexity(
  message: string,
  config: PlanModeConfig = DEFAULT_PLAN_CONFIG,
): number {
  const lowerMessage = message.toLowerCase();
  let score = 0;

  // Check for complexity indicators
  const indicatorCount = config.complexityIndicators.filter((indicator) =>
    lowerMessage.includes(indicator),
  ).length;
  score += Math.min(indicatorCount * 0.15, 0.5);

  // Check message length (longer messages often indicate complexity)
  const wordCount = message.split(/\s+/).length;
  if (wordCount > 50) score += 0.2;
  else if (wordCount > 30) score += 0.1;

  // Check for conjunctions and sequential words
  const sequentialPatterns = [
    /\b(and then|after that|following|subsequently)\b/i,
    /\b(第[一二三四五]步|步骤[0-9]+)\b/,
  ];
  if (sequentialPatterns.some((pattern) => pattern.test(message))) {
    score += 0.2;
  }

  return Math.min(score, 1);
}
