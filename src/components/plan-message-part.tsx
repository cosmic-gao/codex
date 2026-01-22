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
  CircleDashed,
  ListTodo,
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

const StatusIcon = ({ status }: { status: StepStatus }) => {
  return (
    <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background ring-4 ring-background">
      <AnimatePresence mode="wait">
        {status === "completed" ? (
          <motion.div
            key="completed"
            initial={{ scale: 0, opacity: 0, rotate: -180 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
          >
            <CheckCircle2 className="size-5 text-emerald-500" />
          </motion.div>
        ) : status === "in_progress" ? (
          <motion.div
            key="in_progress"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ 
              scale: 1, 
              opacity: 1,
            }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
          >
            <motion.div
              animate={{ 
                scale: [1, 1.1, 1],
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity,
                ease: "easeInOut" 
              }}
            >
              <Loader2 className="size-5 animate-spin text-blue-500" />
            </motion.div>
          </motion.div>
        ) : status === "failed" ? (
          <motion.div
            key="failed"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ 
              scale: 1, 
              opacity: 1,
            }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 10 }}
          >
            <motion.div
              animate={{ 
                rotate: [0, -10, 10, -10, 0],
              }}
              transition={{ 
                duration: 0.5,
                times: [0, 0.25, 0.5, 0.75, 1]
              }}
            >
              <XCircle className="size-5 text-red-500" />
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="pending"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <CircleDashed className="size-5 text-muted-foreground/40" />
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
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <motion.div
        className={cn(
          "h-full rounded-full",
          hasFailure ? "bg-red-500" : "bg-primary"
        )}
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
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
}: {
  step: DeepPartial<PlanToolOutput["steps"][number]> | DeepPartial<OutlineToolOutput["steps"][number]>;
  status: StepStatus;
  index: number;
  isLast: boolean;
  actions?: { label: string; value?: string }[];
  outputs?: Array<{ toolName?: string; output: unknown }>;
  progressStep?: PlanProgress["steps"][number];
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
    <div className="group relative flex gap-4">
      {/* Timeline Line */}
      {!isLast && (
        <div
          className={cn(
            "absolute left-3 top-8 -bottom-4 w-px bg-border group-last:hidden",
            status === "completed" ? "bg-primary/20" : "bg-border/50",
          )}
        />
      )}

      {/* Status Icon */}
      <StatusIcon status={status} />

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
                  "text-sm font-medium leading-none transition-colors",
                  status === "completed" && "text-muted-foreground",
                  status === "in_progress" && "text-primary",
                  status === "failed" && "text-red-500",
                )}
              >
                {step.title || "Generating step..."}
              </h4>
              {complexityLabel && (
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  complexity === "3" && "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
                  complexity === "2" && "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                  complexity === "1" && "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                )}>
                  <Zap className="size-2.5" />
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
            {step.description && (
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
              <div className="mt-2 space-y-2">
                {step.description && (
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                )}
                {displayActions && displayActions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {displayActions.map((action, i) => (
                      <div
                        key={i}
                        className="rounded bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground"
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
                          className="rounded-md border bg-background/50 p-2"
                        >
                          <div className="mb-1 text-[10px] font-medium text-muted-foreground">
                            {item.toolName ?? "tool"}
                          </div>
                          <pre className="whitespace-pre-wrap text-xs leading-relaxed">
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
        "group overflow-hidden rounded-xl border bg-card/50 text-card-foreground shadow-sm transition-all hover:bg-card/80",
        className,
      )}
    >
      {/* Header */}
      <div className="border-b bg-muted/20">
        <div
          className="flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <ListTodo className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold truncate">{plan.title || "Generating plan..."}</h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <span className={cn(
                    "font-medium",
                    hasFailed && "text-red-500",
                    isComplete && "text-emerald-500"
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
                  <span className="flex items-center gap-1 text-primary">
                    <Loader2 className="size-3 animate-spin" />
                    Generating...
                  </span>
                )}
              </div>
            </div>
          </div>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200 shrink-0 ml-2",
              isCollapsed && "rotate-180",
            )}
          />
        </div>
        {/* Progress Bar */}
        <div className="px-4 pb-3">
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
