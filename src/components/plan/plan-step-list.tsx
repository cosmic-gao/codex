"use client";

import { memo } from "react";
import { PlanStepItem } from "./plan-step-item";
import { DeepPartial, OutlineToolOutput, PlanToolOutput, PlanProgress } from "app-types/plan";
import { toStepStatus } from "./plan-utils";
import equal from "lib/equal";

type PlanStepListProps = {
  steps: Array<
    | DeepPartial<PlanToolOutput["steps"][number]>
    | DeepPartial<OutlineToolOutput["steps"][number]>
  >;
  progress: PlanProgress;
  stepOutputs?: Array<Array<{ toolName?: string; output: unknown }>>;
  isActive: boolean;
  description?: string;
};

export const PlanStepList = memo(({
  steps,
  progress,
  stepOutputs,
  isActive,
  description,
}: PlanStepListProps) => {
  return (
    <div className="p-4 pt-6">
      {description && (
        <p className="mb-6 text-sm text-muted-foreground">
          {description}
        </p>
      )}
      <div className="relative pl-2">
        {steps.map((step, index) => {
          const status = toStepStatus(
            progress.steps[index]?.status ?? "pending",
          );
          const actions = progress.steps[index]?.actions;
          const outputs = stepOutputs?.[index];
          const progressStep = progress.steps[index];
          const isCurrent = progress.currentStepIndex === index;
          const prevStatus = index > 0 
            ? toStepStatus(progress.steps[index - 1]?.status ?? "pending") 
            : undefined;
          return (
            <PlanStepItem
              key={index}
              step={step}
              status={status}
              prevStatus={prevStatus}
              index={index}
              isLast={index === steps.length - 1}
              actions={actions}
              outputs={outputs}
              progressStep={progressStep}
              isCurrent={isCurrent}
              isActive={isActive}
            />
          );
        })}
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.steps === next.steps &&
         equal(prev.progress, next.progress) &&
         equal(prev.stepOutputs, next.stepOutputs) &&
         prev.isActive === next.isActive &&
         prev.description === next.description;
});
