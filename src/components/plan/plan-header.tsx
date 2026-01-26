"use client";

import { memo } from "react";
import { cn } from "lib/utils";
import { motion } from "framer-motion";
import { ChevronDown, Loader2 } from "lucide-react";
import { PlanDurationText } from "./plan-duration";

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

export const PlanHeader = memo(({
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
