"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { formatDuration } from "./plan-utils";

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

export function PlanDurationText({
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

export function StepDurationText({
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
  if (!isRunning && !endTime) return null;
  const end = endTime ?? now;
  const seconds = (end - startTime) / 1000;
  if (seconds < 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Clock className="size-2.5" />
      {formatDuration(seconds)}
    </span>
  );
}
