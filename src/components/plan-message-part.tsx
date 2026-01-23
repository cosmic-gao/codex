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
  Clock,
  Zap,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { memo, useState, useEffect, useMemo } from "react";

type Props = {
  plan: DeepPartial<PlanToolOutput> | DeepPartial<OutlineToolOutput>;
  planId: string;
  progress?: PlanProgress;
  stepOutputs?: Array<Array<{ toolName?: string; output: unknown }>>;
  isStreaming?: boolean;
  isActive?: boolean;
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
    if (!parsed.success) {
      console.warn('[Plan UI] Failed to parse progress data:', parsed.error);
      continue;
    }
    if ((parsed.data.id ?? parsed.data.data.planId) !== planId) continue;
    console.log('[Plan UI] Found progress:', {
      planId,
      steps: parsed.data.data.steps.map((s, i) => ({
        index: i,
        status: s.status,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
      currentStepIndex: parsed.data.data.currentStepIndex,
    });
    return parsed.data.data;
  }
  return undefined;
}

type StepStatus = "pending" | "in_progress" | "completed" | "failed" | "aborted";

function toStepStatus(
  status: PlanProgress["steps"][number]["status"] | "aborted",
): StepStatus {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "aborted" || (status as string) === "cancelled") return "aborted";
  return "pending";
}

const StatusIcon = memo(({ status, index }: { status: StepStatus; index: number }) => {
  return (
    <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card ring-2 ring-card">
      <AnimatePresence mode="sync">
        {status === "completed" ? (
          <motion.div
            key="completed"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
              <CheckCircle2 className="size-3.5" strokeWidth={2.5} />
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
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm">
              <XCircle className="size-3.5" strokeWidth={2.5} />
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
            <div className="relative flex h-6 w-6 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/20 opacity-75"></span>
              <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <span className="text-[10px] font-bold">{index + 1}</span>
              </div>
            </div>
          </motion.div>
        ) : status === "aborted" ? (
           <motion.div
            key="aborted"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/20 bg-muted/30 text-muted-foreground">
               <AlertCircle className="size-3.5" />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="pending"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/20 bg-muted/10 text-muted-foreground/70">
              <span className="text-[10px] font-medium">{index + 1}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function useNow(isActive: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive]);
  return now;
}

function DurationText({
  startTime,
  endTime,
  isRunning,
}: {
  startTime?: number;
  endTime?: number;
  isRunning: boolean;
}) {
  const now = useNow(isRunning);
  if (!startTime) return null;
  // If not running and no endTime, don't show duration (避免显示负数)
  if (!isRunning && !endTime) return null;
  const end = endTime ?? now;
  const seconds = (end - startTime) / 1000;
  // Prevent negative durations
  if (seconds < 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Clock className="size-2.5" />
      {formatDuration(seconds)}
    </span>
  );
}

function PlanDurationText({
  startTime,
  endTime,
  isRunning,
}: {
  startTime?: number;
  endTime?: number;
  isRunning: boolean;
}) {
  const now = useNow(isRunning);
  if (!startTime) return null;
  // If not running and no endTime, don't show duration
  if (!isRunning && !endTime) return null;
  const end = endTime ?? now;
  const seconds = (end - startTime) / 1000;
  // Prevent negative durations
  if (seconds < 0) return null;
  return (
    <span className="flex items-center gap-1">
      <Clock className="size-3" />
      {formatDuration(seconds)}
    </span>
  );
}

function StatusText({
  status,
}: {
  status: StepStatus;
}) {
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

/**
 * Progress bar component
 */
const ProgressBar = memo(({ 
  completed, 
  total, 
  failed 
}: { 
  completed: number; 
  total: number; 
  failed: number;
}) => {
  const percentage = total > 0 ? ((completed + failed) / total) * 100 : 0;
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
}, (prev, next) => 
  prev.completed === next.completed && 
  prev.total === next.total && 
  prev.failed === next.failed
);

// ======================================================================
// LAYER 1: Plan Header - Stable skeleton that rarely changes
// ======================================================================

type PlanHeaderProps = {
  title?: string;
  description?: string;
  completedCount: number;
  totalCount: number;
  failedCount: number;
  inProgressCount: number;
  startTime?: number;
  endTime?: number;
  hasStarted: boolean;
  isStreaming: boolean;
  isActive: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

/**
 * Plan Header - Renders once when plan is created, updates only for progress counts
 */
const PlanHeader = memo(({
  title,
  description,
  completedCount,
  totalCount,
  failedCount,
  inProgressCount,
  startTime,
  endTime,
  hasStarted,
  isStreaming,
  isActive,
  isCollapsed,
  onToggleCollapse
}: PlanHeaderProps) => {
  const hasFailed = failedCount > 0;

  return (
    <div className="border-b bg-background/50">
      <div
        className="flex cursor-pointer items-start justify-between px-4 py-3 transition-colors hover:bg-muted/40"
        onClick={onToggleCollapse}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="flex h-5 w-5 mt-0.5 items-center justify-center rounded-full border-2 border-muted-foreground/30 shrink-0">
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <h3 className="text-base font-bold leading-none">{title || "生成计划中..."}</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className={cn(
                  "font-medium text-muted-foreground",
                  hasFailed && "text-destructive"
                )}>
                  {completedCount}
                </span>
                <span>/</span>
                <span>{totalCount}</span>
                <span>已完成</span>
              </span>
              {hasStarted && (
                <PlanDurationText
                  startTime={startTime}
                  endTime={endTime}
                  isRunning={isActive && inProgressCount > 0}
                />
              )}
              {isStreaming && (
                <span className="flex items-center gap-1 text-primary animate-pulse">
                  <Loader2 className="size-3 animate-spin" />
                  {inProgressCount > 0 ? "执行中..." : "规划中..."}
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
      <div className="px-4 pb-4">
        <ProgressBar 
          completed={completedCount} 
          total={totalCount} 
          failed={failedCount}
        />
      </div>
    </div>
  );
}, (prev, next) => {
  // Only re-render if these specific props change
  return (
    prev.title === next.title &&
    prev.completedCount === next.completedCount &&
    prev.totalCount === next.totalCount &&
    prev.failedCount === next.failedCount &&
    prev.inProgressCount === next.inProgressCount &&
    prev.startTime === next.startTime &&
    prev.endTime === next.endTime &&
    prev.hasStarted === next.hasStarted &&
    prev.isStreaming === next.isStreaming &&
    prev.isActive === next.isActive &&
    prev.isCollapsed === next.isCollapsed
  );
});

// ======================================================================
// LAYER 2: Plan Step Item - Updates based on individual step progress
// ======================================================================

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

/**
 * Individual step item - Only re-renders when its own progress changes
 */
const PlanStepItem = memo(({
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

  // Debug logging
  useEffect(() => {
    console.log(`[Plan UI] Step ${index} render:`, {
      title: step.title,
      status,
      isCurrent,
      isActive,
      startTime: progressStep?.startTime,
      endTime: progressStep?.endTime,
      hasStartTime: Boolean(progressStep?.startTime),
    });
  }, [index, step.title, status, isCurrent, isActive, progressStep?.startTime, progressStep?.endTime]);

  useEffect(() => {
    if (status === "in_progress" || status === "failed" || Boolean(progressStep?.errorMessage)) {
      setIsExpanded(true);
    }
  }, [status, progressStep?.errorMessage]);
  
  const displayActions = actions && actions.length > 0 ? actions : ("actions" in step ? step.actions : undefined);
  const displayOutputs = outputs ?? [];

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
              <DurationText
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
    // Fine-grained comparison - only re-render if relevant props change
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

// ======================================================================
// LAYER 3: Plan Step List - Contains all steps, memoized by step array
// ======================================================================

type PlanStepListProps = {
  steps: Array<DeepPartial<PlanToolOutput["steps"][number]> | DeepPartial<OutlineToolOutput["steps"][number]>>;
  progress: PlanProgress;
  stepOutputs?: Array<Array<{ toolName?: string; output: unknown }>>;
  isActive: boolean;
  description?: string;
};

/**
 * Step list container - Only re-renders when steps array or progress changes
 */
const PlanStepList = memo(({
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
  // Only re-render if steps structure or progress state changes
  return prev.steps === next.steps &&
         equal(prev.progress, next.progress) &&
         equal(prev.stepOutputs, next.stepOutputs) &&
         prev.isActive === next.isActive &&
         prev.description === next.description;
});

// ======================================================================
// ROOT: Plan Message Part - Top-level orchestrator
// ======================================================================

function PurePlanMessagePart({
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

  // Default progress if not provided
  const progress = useMemo(() => 
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
    } satisfies PlanProgress),
    [inputProgress, planId, steps]
  );

  // Calculate metrics for header
  const metrics = useMemo(() => {
    const completedCount = progress.steps.filter(s => s.status === "completed").length;
    const failedCount = progress.steps.filter(s => s.status === "failed").length;
    const inProgressCount = progress.steps.filter(s => s.status === "in_progress").length;
    
    // 获取所有步骤的开始和结束时间
    const allStartTimes = progress.steps
      .map(s => s.startTime)
      .filter((t): t is number => t !== undefined);
    
    const completedEndTimes = progress.steps
      .filter(s => s.status === "completed" || s.status === "failed")
      .map(s => s.endTime)
      .filter((t): t is number => t !== undefined);
    
    // 总体开始时间 = 最早的开始时间
    const startTime = allStartTimes.length > 0 ? Math.min(...allStartTimes) : undefined;
    
    // 总体结束时间 = 如果所有步骤都完成，取最晚的结束时间；否则 undefined（让计时器继续）
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

/**
 * Main export - Only re-renders when plan structure or progress changes
 */
export const PlanMessagePart = memo(PurePlanMessagePart, (prev, next) => {
  // Top-level comparison - delegates to child components for granular updates
  if (prev.planId !== next.planId) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.isActive !== next.isActive) return false;
  if (prev.plan !== next.plan) return false;
  if (!equal(prev.progress, next.progress)) return false;
  if (!equal(prev.stepOutputs, next.stepOutputs)) return false;
  return true;
});
