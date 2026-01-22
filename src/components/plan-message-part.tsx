"use client";

import type { PlanToolOutput } from "app-types/plan";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";
import {
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  type QueueItemStatus,
} from "@/components/ai-elements/queue";
import { cn } from "lib/utils";
import { PlanProgressDataPartSchema, type PlanProgress } from "app-types/plan";

import { memo } from "react";
import equal from "lib/equal";

type Props = {
  plan: PlanToolOutput;
  planId: string;
  progress?: PlanProgress;
  isStreaming?: boolean;
  className?: string;
};

export function getLatestPlanProgress(
  messageParts: Array<{ type: string; id?: string; data?: unknown }> | undefined,
  planId: string,
): PlanProgress | undefined {
  if (!messageParts) return undefined;
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

function toQueueStatus(status: PlanProgress["steps"][number]["status"]): QueueItemStatus {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

function PurePlanMessagePart({
  plan,
  planId,
  progress: inputProgress,
  isStreaming = false,
  className,
}: Props) {
  const progress =
    inputProgress ??
    ({
      planId,
      steps: plan.steps.map(() => ({ status: "pending" as const })),
      currentStepIndex: plan.steps.length ? 0 : undefined,
    } satisfies PlanProgress);

  const completedCount = progress.steps.filter(
    (s) => s.status === "completed",
  ).length;

  return (
    <Plan
      defaultOpen={false}
      isStreaming={isStreaming}
      className={cn("border bg-transparent py-4", className)}
    >
      <PlanHeader className="px-4 py-0">
        <div className="flex flex-col gap-1">
          <PlanTitle className="text-sm">{plan.title}</PlanTitle>
          {plan.description ? (
            <PlanDescription className="text-xs">
              {plan.description}
            </PlanDescription>
          ) : null}
        </div>
        <PlanAction>
          <PlanTrigger />
        </PlanAction>
      </PlanHeader>

      <PlanContent className="px-4 pt-3 pb-0">
        <div className="mb-2 text-xs text-muted-foreground">
          已完成 {completedCount}/{plan.steps.length}
        </div>
        <QueueList>
          {plan.steps.map((step, index) => {
            const status = progress.steps[index]?.status ?? "pending";
            const queueStatus = toQueueStatus(status);
            return (
              <QueueItem key={`${index}-${step.title}`} status={queueStatus}>
                <QueueItemIndicator status={queueStatus} />
                <QueueItemContent title={step.title}>
                  {step.description ? (
                    <QueueItemDescription>{step.description}</QueueItemDescription>
                  ) : null}
                  {step.actions?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {step.actions.map((action) => (
                        <div
                          key={`${action.label}-${action.value ?? ""}`}
                          className="rounded-md border px-2 py-1 text-xs text-muted-foreground"
                        >
                          {action.value
                            ? `${action.label}: ${action.value}`
                            : action.label}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </QueueItemContent>
              </QueueItem>
            );
          })}
        </QueueList>
      </PlanContent>
    </Plan>
  );
}

export const PlanMessagePart = memo(PurePlanMessagePart, (prev, next) => {
  if (prev.planId !== next.planId) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (!equal(prev.plan, next.plan)) return false;
  if (!equal(prev.progress, next.progress)) return false;
  return true;
});
