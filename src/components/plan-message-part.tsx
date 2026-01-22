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
} from "lucide-react";
import { memo, useState, useEffect } from "react";

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
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <CheckCircle2 className="size-5 text-emerald-500" />
          </motion.div>
        ) : status === "in_progress" ? (
          <motion.div
            key="in_progress"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <Loader2 className="size-5 animate-spin text-blue-500" />
          </motion.div>
        ) : status === "failed" ? (
          <motion.div
            key="failed"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <XCircle className="size-5 text-red-500" />
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

const PlanStep = ({
  step,
  status,
  index,
  isLast,
  actions,
  outputs,
}: {
  step: DeepPartial<PlanToolOutput["steps"][number]>;
  status: StepStatus;
  index: number;
  isLast: boolean;
  actions?: { label: string; value?: string }[];
  outputs?: Array<{ toolName?: string; output: unknown }>;
}) => {
  const [isExpanded, setIsExpanded] = useState(
    status === "in_progress" || status === "failed",
  );

  useEffect(() => {
    if (status === "in_progress" || status === "failed") {
      setIsExpanded(true);
    }
  }, [status]);
  
  // Use actions from progress if available, otherwise fallback to plan step actions
  const displayActions = actions && actions.length > 0 ? actions : step.actions;
  const displayOutputs = outputs ?? [];

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
          <div className="space-y-1">
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
            {step.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {step.description}
              </p>
            )}
          </div>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200",
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

  const steps = plan.steps || [];

  const progress =
    inputProgress ??
    ({
      planId,
      steps: steps.map(() => ({ status: "pending" as const, actions: undefined })),
      currentStepIndex: steps.length ? 0 : undefined,
    } satisfies PlanProgress);

  const completedCount = progress.steps.filter(
    (s) => s.status === "completed",
  ).length;

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-xl border bg-card/50 text-card-foreground shadow-sm transition-all hover:bg-card/80",
        className,
      )}
    >
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between border-b bg-muted/20 px-4 py-3 transition-colors hover:bg-muted/40"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListTodo className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{plan.title || "Generating plan..."}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {completedCount} of {steps.length} completed
              </span>
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
            "size-4 text-muted-foreground transition-transform duration-200",
            isCollapsed && "rotate-180",
          )}
        />
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
                  return (
                    <PlanStep
                      key={index}
                      step={step}
                      status={status}
                      index={index}
                      isLast={index === steps.length - 1}
                      actions={actions}
                      outputs={outputs}
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
