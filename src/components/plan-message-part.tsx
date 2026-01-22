"use client";

import type { OutlineToolOutput, PlanToolOutput, PlanProgress, DeepPartial } from "app-types/plan";
import { PlanProgressDataPartSchema } from "app-types/plan";
import { cn } from "lib/utils";
import { truncateString } from "lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import equal from "lib/equal";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  XCircle,
  Clock,
  Zap,
} from "lucide-react";
import { memo, useState, useEffect, useMemo } from "react";

type Props = {
  plan: DeepPartial<PlanToolOutput> | DeepPartial<OutlineToolOutput>;
  planId: string;
  progress?: PlanProgress;
  stepOutputs?: Array<Array<{ toolName?: string; output: unknown }>>;
  isStreaming?: boolean;
  className?: string;
};

export function getLatestPlanProgress(
  messageParts:
    | Array<{ type: string; id?: string; data?: unknown }>
    | undefined,
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

type StepStatus = "pending" | "in_progress" | "completed" | "failed";

function toStepStatus(
  status: PlanProgress["steps"][number]["status"],
): StepStatus {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

const StatusIcon = ({ status, index }: { status: StepStatus; index: number }) => {
  return (
    <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background">
      <AnimatePresence mode="wait">
        {status === "completed" ? (
          <motion.div
            key="completed"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-primary-foreground">
              <CheckCircle2 className="size-4" />
            </div>
          </motion.div>
        ) : status === "in_progress" ? (
          <motion.div
            key="in_progress"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <span className="text-[10px] font-bold">{index + 1}</span>
            </div>
          </motion.div>
        ) : status === "failed" ? (
          <motion.div
            key="failed"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
              <XCircle className="size-4" />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="pending"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-muted bg-background text-muted-foreground">
              <span className="text-[10px] font-medium">{index + 1}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Progress bar component
 */
const ProgressBar = ({ 
  completed, 
  total, 
  failed 
}: { 
  completed: number; 
  total: number; 
  failed: number;
}) => {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  const hasFailure = failed > 0;

  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
      <motion.div
        className={cn(
          "h-full rounded-full",
          hasFailure 
            ? "bg-destructive" 
            : "bg-primary"
        )}
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
};

const PlanStep = ({
  step,
  status,
  index,
  isLast,
  actions,
  outputs,
  progressStep,
  isCurrent = false,
}: {
  step: DeepPartial<PlanToolOutput["steps"][number]> | DeepPartial<OutlineToolOutput["steps"][number]>;
  status: StepStatus;
  index: number;
  isLast: boolean;
  actions?: { label: string; value?: string }[];
  outputs?: Array<{ toolName?: string; output: unknown }>;
  progressStep?: PlanProgress["steps"][number];
  isCurrent?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(
    status === "in_progress" || status === "failed",
  );
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    if (status === "in_progress" || status === "failed") {
      setIsExpanded(true);
    }
  }, [status]);

  // Update current time for live duration display
  useEffect(() => {
    if (status === "in_progress" && progressStep?.startTime) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status, progressStep?.startTime]);
  
  // Use actions from progress if available, otherwise fallback to plan step actions
  const displayActions = actions && actions.length > 0 ? actions : ("actions" in step ? step.actions : undefined);
  const displayOutputs = outputs ?? [];

  // Calculate step duration
  const duration = useMemo(() => {
    if (!progressStep) return null;
    
    if (progressStep.startTime && progressStep.endTime) {
      return (progressStep.endTime - progressStep.startTime) / 1000;
    } else if (progressStep.startTime && status === "in_progress") {
      return (currentTime - progressStep.startTime) / 1000;
    }
    return null;
  }, [progressStep, status, currentTime]);

  // Get complexity indicator
  const complexity = (step as any).complexity;
  const complexityLabel = complexity === "3" ? "Complex" : complexity === "2" ? "Moderate" : complexity === "1" ? "Simple" : null;

  return (
    <div className={cn(
      "group relative flex gap-4 transition-all duration-300",
      isCurrent && "rounded-lg bg-muted/30 -mx-2 px-2 py-2"
    )}>
      {/* Timeline Line */}
      {!isLast && (
        <div
          className={cn(
            "absolute left-3 top-8 -bottom-4 w-px -ml-px transition-colors duration-300",
            status === "completed" ? "bg-primary/20" : "bg-border/40",
          )}
        />
      )}

      {/* Status Icon */}
      <StatusIcon status={status} index={index} />

      {/* Content */}
      <div className="flex-1 pb-6">
        <div
          className="flex cursor-pointer items-start justify-between gap-2"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4
                className={cn(
                  "text-sm font-medium leading-none transition-all duration-300",
                  status === "completed" && "text-foreground",
                  status === "in_progress" && "text-primary font-bold",
                  status === "failed" && "text-red-500",
                  status === "pending" && "text-foreground/70",
                  isCurrent && "text-primary"
                )}
              >
                {step.title || "Generating step..."}
              </h4>
              {complexityLabel && (
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm",
                  complexity === "3" && "bg-gradient-to-r from-orange-500 to-orange-600 text-white",
                  complexity === "2" && "bg-gradient-to-r from-blue-500 to-blue-600 text-white",
                  complexity === "1" && "bg-gradient-to-r from-green-500 to-green-600 text-white"
                )}>
                  <Zap className="size-3" />
                  {complexityLabel}
                </span>
              )}
              {duration !== null && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="size-2.5" />
                  {formatDuration(duration)}
                </span>
              )}
            </div>
            {step.description && !isExpanded && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {step.description}
              </p>
            )}
            {progressStep?.errorMessage && (
              <p className="text-xs text-red-500 line-clamp-2">
                Error: {progressStep.errorMessage}
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

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-3">
                {step.description && (
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {step.description}
                  </div>
                )}
                {displayActions && displayActions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

function PurePlanMessagePart({
  plan,
  planId,
  progress: inputProgress,
  stepOutputs,
  isStreaming = false,
  className,
}: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const steps = plan.steps || [];

  const progress =
    inputProgress ??
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

  const completedCount = progress.steps.filter(
    (s) => s.status === "completed",
  ).length;

  const failedCount = progress.steps.filter(
    (s) => s.status === "failed",
  ).length;

  const inProgressCount = progress.steps.filter(
    (s) => s.status === "in_progress",
  ).length;

  // Calculate timing metrics
  const timingMetrics = useMemo(() => {
    const stepsWithTiming = progress.steps.filter(
      (s) => s.startTime !== undefined
    );

    if (stepsWithTiming.length === 0) {
      return { totalDuration: 0, hasStarted: false };
    }

    const startTimes = stepsWithTiming
      .map((s) => s.startTime)
      .filter((t): t is number => t !== undefined);
    const endTimes = stepsWithTiming
      .map((s) => s.endTime)
      .filter((t): t is number => t !== undefined);

    const minStart = startTimes.length > 0 ? Math.min(...startTimes) : undefined;
    const maxEnd = endTimes.length > 0 ? Math.max(...endTimes) : undefined;

    // If there are in-progress steps, use current time as end
    const effectiveEnd = inProgressCount > 0 ? currentTime : maxEnd;

    const totalDuration =
      minStart && effectiveEnd ? (effectiveEnd - minStart) / 1000 : 0;

    return {
      totalDuration,
      hasStarted: minStart !== undefined,
    };
  }, [progress.steps, inProgressCount, currentTime]);

  // Update current time every second for live timing
  useEffect(() => {
    if (inProgressCount > 0) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [inProgressCount]);

  const isComplete = completedCount === steps.length && steps.length > 0;
  const hasFailed = failedCount > 0;

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-all",
        className,
      )}
    >
      {/* Header */}
      <div className="border-b bg-background/50">
        <div
          className="flex cursor-pointer items-start justify-between px-4 py-3 transition-colors hover:bg-muted/40"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex h-5 w-5 mt-0.5 items-center justify-center rounded-full border-2 border-muted-foreground/30 shrink-0">
              <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <h3 className="text-base font-bold leading-none">{plan.title || "Generating plan..."}</h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className={cn(
                    "font-medium text-muted-foreground",
                    hasFailed && "text-destructive"
                  )}>
                    {completedCount}
                  </span>
                  <span>/</span>
                  <span>{steps.length}</span>
                  <span>completed</span>
                </span>
                {timingMetrics.hasStarted && (
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {formatDuration(timingMetrics.totalDuration)}
                  </span>
                )}
                {isStreaming && (
                  <span className="flex items-center gap-1 text-primary animate-pulse">
                    <Loader2 className="size-3 animate-spin" />
                    {inProgressCount > 0 ? "Executing..." : "Planning..."}
                  </span>
                )}
              </div>
            </div>
          </div>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200 shrink-0 ml-2 mt-1",
              isCollapsed && "rotate-180",
            )}
          />
        </div>
        {/* Progress Bar */}
        <div className="px-4 pb-4">
          <ProgressBar 
            completed={completedCount} 
            total={steps.length} 
            failed={failedCount}
          />
        </div>
      </div>

      {/* Content */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 pt-6">
              {plan.description && (
                <p className="mb-6 text-sm text-muted-foreground">
                  {plan.description}
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
                  return (
                    <PlanStep
                      key={index}
                      step={step}
                      status={status}
                      index={index}
                      isLast={index === steps.length - 1}
                      actions={actions}
                      outputs={outputs}
                      progressStep={progressStep}
                      isCurrent={isCurrent}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const PlanMessagePart = memo(PurePlanMessagePart, (prev, next) => {
  if (prev.planId !== next.planId) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (!equal(prev.plan, next.plan)) return false;
  if (!equal(prev.progress, next.progress)) return false;
  if (!equal(prev.stepOutputs, next.stepOutputs)) return false;
  return true;
});
