import { PlanProgress, PlanProgressDataPartSchema, PlanStepOutputDataPartSchema } from "app-types/plan";
import { UIMessage } from "ai";

export type StepStatus = "pending" | "in_progress" | "completed" | "failed" | "aborted";

export function toStepStatus(
  status: PlanProgress["steps"][number]["status"] | "aborted" | string,
): StepStatus {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "aborted" || status === "cancelled") return "aborted";
  return "pending";
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Extract the latest authoritative plan progress from message parts.
 * No inference, no guessing. Just the latest data-plan-progress.
 */
export function getLatestPlanProgress(
  messageParts: Array<{ type: string; id?: string; data?: unknown }> | undefined,
  planId: string,
): PlanProgress | undefined {
  if (!messageParts) return undefined;
  
  // Iterate backwards to find the latest update
  for (let i = messageParts.length - 1; i >= 0; i -= 1) {
    const part = messageParts[i];
    if (!part || part.type !== "data-plan-progress") continue;
    
    const parsed = PlanProgressDataPartSchema.safeParse(part);
    if (!parsed.success) continue;
    
    if ((parsed.data.id ?? parsed.data.data.planId) !== planId) continue;
    
    return parsed.data.data;
  }
  return undefined;
}

export function getPlanStepOutputs(
  messageParts: UIMessage["parts"] | undefined,
  planId: string,
) {
  const outputsByStepIndex: Array<Array<{ toolName?: string; output: unknown }>> =
    [];
  if (!messageParts) return outputsByStepIndex;
  for (const part of messageParts) {
    const parsed = PlanStepOutputDataPartSchema.safeParse(part);
    if (!parsed.success) continue;
    if ((parsed.data.id ?? parsed.data.data.planId) !== planId) continue;
    const { stepIndex, toolName, output } = parsed.data.data;
    outputsByStepIndex[stepIndex] ??= [];
    outputsByStepIndex[stepIndex]!.push({ toolName, output });
  }
  return outputsByStepIndex;
}
