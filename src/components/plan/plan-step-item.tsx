"use client";

import { memo, useState, useEffect, useMemo } from "react";
import { cn } from "lib/utils";
import { truncateString } from "lib/utils";
import { ChevronDown, Zap } from "lucide-react";
import { StepStatus } from "./plan-utils";
import { StatusIcon } from "./plan-status-icon";
import { StepDurationText } from "./plan-duration";
import equal from "lib/equal";
import { DeepPartial, OutlineToolOutput, PlanToolOutput, PlanProgress } from "app-types/plan";

type PlanStepItemProps = {
  step: DeepPartial<PlanToolOutput["steps"][number]> | DeepPartial<OutlineToolOutput["steps"][number]>;
  status: StepStatus;
  prevStatus?: StepStatus;
  index: number;
  isLast: boolean;
  actions?: { label: string; value?: string }[];
  outputs?: Array<{ toolName?: string; output: unknown }>;
  progressStep?: PlanProgress["steps"][number];
  isCurrent?: boolean;
  isActive?: boolean;
};

function StatusText({ status }: { status: StepStatus }) {
  const label =
    status === "completed" ? "完成" : 
    status === "in_progress" ? "进行中" : 
    status === "failed" ? "失败" :
    status === "aborted" ? "已中止" :
    "等待";
    
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        status === "completed" && "bg-emerald-500/10 text-emerald-700",
        status === "failed" && "bg-destructive/10 text-destructive",
        status === "in_progress" && "bg-primary/10 text-primary",
        status === "pending" && "bg-muted/40 text-muted-foreground",
        status === "aborted" && "bg-muted/40 text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export const PlanStepItem = memo(({
  step,
  status,
  prevStatus,
  index,
  isLast,
  actions,
  outputs,
  progressStep,
  isCurrent = false,
  isActive = false,
}: PlanStepItemProps) => {
  const [isExpanded, setIsExpanded] = useState(
    status === "in_progress" || status === "failed" || Boolean(progressStep?.errorMessage),
  );

  useEffect(() => {
    if (status === "in_progress" || status === "failed" || Boolean(progressStep?.errorMessage)) {
      setIsExpanded(true);
    }
  }, [status, progressStep?.errorMessage]);
  
  const displayActions = actions && actions.length > 0 ? actions : ("actions" in step ? step.actions : undefined);
  
  const displayOutputs = useMemo(() => {
    if (!outputs || outputs.length === 0) return [];
    
    const merged: Array<{ toolName?: string; output: unknown }> = [];
    let lastAssistantIndex = -1;

    outputs.forEach((item) => {
      if (item.toolName === 'assistant' && typeof item.output === 'string') {
        if (lastAssistantIndex !== -1) {
          const prev = merged[lastAssistantIndex];
          if (typeof prev.output === 'string') {
            prev.output += item.output;
            return;
          }
        }
        lastAssistantIndex = merged.length;
        merged.push({ ...item });
      } else {
        lastAssistantIndex = -1;
        merged.push(item);
      }
    });
    
    return merged;
  }, [outputs]);

  const errorText = useMemo(() => {
    const message = progressStep?.errorMessage;
    if (!message) return undefined;
    if (message === "aborted") return "已中止";
    return `错误: ${message}`;
  }, [progressStep?.errorMessage]);

  const complexity = (step as any).complexity;
  const complexityLabel = complexity === "3" ? "Complex" : complexity === "2" ? "Moderate" : complexity === "1" ? "Simple" : null;

  return (
    <div className={cn(
      "group relative flex gap-4 rounded-lg px-2 py-2 transition-colors duration-200",
      isCurrent ? "bg-muted/40" : "hover:bg-muted/10"
    )}>
      {/* Upper Line */}
      {index > 0 && (
        <div
          className={cn(
            "absolute left-5 top-0 h-8 w-[1.5px] -translate-x-1/2 transition-colors duration-300",
            prevStatus === "completed" ? "bg-primary/30" : "bg-border/60",
          )}
        />
      )}
      
      {/* Lower Line */}
      {!isLast && (
        <div
          className={cn(
            "absolute left-5 top-8 bottom-0 w-[1.5px] -translate-x-1/2 transition-colors duration-300",
            status === "completed" ? "bg-primary/30" : "bg-border/60",
          )}
        />
      )}

      <StatusIcon status={status} index={index} />

      <div className="flex-1 pb-6">
        <div
          className="flex cursor-pointer items-start justify-between gap-2"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4
                className={cn(
                  "text-sm font-medium leading-none transition-colors duration-200",
                  status === "completed" && "text-foreground",
                  status === "in_progress" && "text-primary font-bold",
                  status === "failed" && "text-destructive font-bold",
                  status === "pending" && "text-muted-foreground",
                  isCurrent && "text-primary"
                )}
              >
                {step.title || "Generating step..."}
              </h4>
              <StatusText status={status} />
              {complexityLabel && (
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm",
                  complexity === "3" && "bg-linear-to-r from-orange-500 to-orange-600 text-white",
                  complexity === "2" && "bg-linear-to-r from-blue-500 to-blue-600 text-white",
                  complexity === "1" && "bg-linear-to-r from-green-500 to-green-600 text-white"
                )}>
                  <Zap className="size-3" />
                  {complexityLabel}
                </span>
              )}
              <StepDurationText
                startTime={progressStep?.startTime}
                endTime={progressStep?.endTime}
                isRunning={
                  isActive &&
                  isCurrent &&
                  status === "in_progress"
                }
              />
            </div>
            {step.description && !isExpanded && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {step.description}
              </p>
            )}
            {errorText && (
              <p className="text-xs text-destructive line-clamp-2 font-medium">
                {errorText}
              </p>
            )}
          </div>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200 shrink-0",
              isExpanded && "rotate-180",
            )}
          />
        </div>

        {isExpanded && (
          <div className="mt-2 space-y-3">
            {step.description && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                {step.description}
              </div>
            )}
            
            {((displayActions && displayActions.length > 0) || (displayOutputs && displayOutputs.length > 0)) && (
               <div className="mt-3 border-t border-border/50 pt-3">
                  {displayActions && displayActions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {displayActions.map((action, i) => (
                        <div
                          key={i}
                          className="inline-flex items-center rounded-full border bg-secondary/50 px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
                        >
                          {action.label}
                          {action.value && `: ${action.value}`}
                        </div>
                      ))}
                    </div>
                  )}
                  {displayOutputs.length > 0 && (
                    <div className="space-y-2">
                      {displayOutputs.map((item, i) => {
                        const raw =
                          typeof item.output === "string"
                            ? item.output
                            : (() => {
                                try {
                                  return JSON.stringify(item.output, null, 2);
                                } catch {
                                  return String(item.output);
                                }
                              })();
                        const text = truncateString(raw, 1600);
                        return (
                          <div
                            key={i}
                            className="rounded-lg border bg-card p-3 shadow-sm"
                          >
                            <div className="mb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {item.toolName ?? "tool"}
                            </div>
                            <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono">
                              {text}
                            </pre>
                          </div>
                        );
                      })}
                    </div>
                  )}
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
    return equal(prev.step, next.step) &&
           prev.status === next.status &&
           prev.prevStatus === next.prevStatus &&
           prev.index === next.index &&
           prev.isLast === next.isLast &&
           equal(prev.actions, next.actions) &&
           equal(prev.outputs, next.outputs) &&
           equal(prev.progressStep, next.progressStep) &&
           prev.isCurrent === next.isCurrent &&
           prev.isActive === next.isActive;
});
