"use client";

import { memo, useMemo, useState } from "react";
import { DeepPartial, OutlineToolOutput, PlanToolOutput, PlanProgress } from "app-types/plan";
import { cn } from "lib/utils";
import equal from "lib/equal";
import { PlanHeader } from "./plan-header";
import { PlanStepList } from "./plan-step-list";

type Props = {
  plan: DeepPartial<PlanToolOutput> | DeepPartial<OutlineToolOutput>;
  planId: string;
  progress?: PlanProgress;
  stepOutputs?: Array<Array<{ toolName?: string; output: unknown }>>;
  isStreaming?: boolean;
  isActive?: boolean;
  className?: string;
};

function PurePlanCard({
  plan,
  planId,
  progress: inputProgress,
  stepOutputs,
  isStreaming = false,
  isActive = false,
  className,
}: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const steps = plan.steps || [];

  // Use progress as-is, without inference
  // Fallback to initial pending state if no progress provided yet
  const progress = useMemo(() => {
    return inputProgress ??
      ({
        planId,
        steps: steps.map(() => ({
          status: "pending" as const,
          actions: undefined,
          startTime: undefined,
          endTime: undefined,
          toolCalls: undefined,
          errorMessage: undefined,
        })),
        currentStepIndex: steps.length ? 0 : undefined,
      } satisfies PlanProgress);
  }, [inputProgress, planId, steps]);

  // Calculate metrics for header
  const metrics = useMemo(() => {
    const completedCount = progress.steps.filter(s => s.status === "completed").length;
    const failedCount = progress.steps.filter(s => s.status === "failed").length;
    const inProgressCount = progress.steps.filter(s => s.status === "in_progress").length;
    
    const allStartTimes = progress.steps
      .map(s => s.startTime)
      .filter((t): t is number => t !== undefined);
    
    const completedEndTimes = progress.steps
      .filter(s => s.status === "completed" || s.status === "failed")
      .map(s => s.endTime)
      .filter((t): t is number => t !== undefined);
    
    const startTime = allStartTimes.length > 0 ? Math.min(...allStartTimes) : undefined;
    
    const allStepsFinished = progress.steps.length > 0 && 
      progress.steps.every(s => s.status === "completed" || s.status === "failed");
    const endTime = allStepsFinished && completedEndTimes.length > 0 
      ? Math.max(...completedEndTimes) 
      : undefined;
    
    return {
      completedCount,
      failedCount,
      inProgressCount,
      startTime,
      endTime,
      hasStarted: allStartTimes.length > 0,
    };
  }, [progress.steps]);

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow",
        className,
      )}
    >
      <PlanHeader 
        title={plan.title}
        description={plan.description}
        completedCount={metrics.completedCount}
        totalCount={steps.length}
        failedCount={metrics.failedCount}
        inProgressCount={metrics.inProgressCount}
        startTime={metrics.startTime}
        endTime={metrics.endTime}
        hasStarted={metrics.hasStarted}
        isStreaming={isStreaming}
        isActive={isActive}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      />

      {!isCollapsed && (
        <PlanStepList
          steps={steps}
          progress={progress}
          stepOutputs={stepOutputs}
          isActive={isActive}
          description={plan.description}
        />
      )}
    </div>
  );
}

export const PlanCard = memo(PurePlanCard, (prev, next) => {
  if (prev.planId !== next.planId) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.isActive !== next.isActive) return false;
  if (prev.plan !== next.plan) return false;
  if (!equal(prev.progress, next.progress)) return false;
  if (!equal(prev.stepOutputs, next.stepOutputs)) return false;
  return true;
});
