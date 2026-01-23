/**
 * Plan progress tracker
 *
 * @description
 * Enhanced progress tracking for plan execution with better step boundary
 * detection, error handling, and timing metrics.
 */

import { UIMessageStreamWriter } from "ai";
import { DefaultToolName } from "../tools";
import { ProgressInput } from "../tools/planning/progress";
import {
  recordStepCompleted,
  recordStepFailed,
  recordPlanCompleted,
  recordPlanFailed,
} from "../analytics/plan-analytics";

export interface StepProgress {
  status: "pending" | "in_progress" | "completed" | "failed";
  actions?: { label: string; value?: string }[];
  startTime?: number;
  endTime?: number;
  toolCalls?: string[];
  errorMessage?: string;
}

export interface PlanProgressState {
  planId: string;
  steps: StepProgress[];
  currentStepIndex?: number;
  totalStartTime?: number;
}

export class PlanProgressTracker {
  private progressStore: Map<string, PlanProgressState>;
  private dataStream: UIMessageStreamWriter;
  private toolNameByToolCallId: Map<string, string>;
  private activePlanId?: string;
  private isExplicitMode: boolean;
  private activeStepIndex?: number;
  private isStopped: boolean;

  constructor(
    progressStore: Map<string, PlanProgressState>,
    dataStream: UIMessageStreamWriter,
  ) {
    this.progressStore = progressStore;
    this.dataStream = dataStream;
    this.toolNameByToolCallId = new Map();
    this.isExplicitMode = false;
    this.isStopped = false;
  }

  setActivePlanId(planId: string): void {
    if (this.activePlanId && this.activePlanId !== planId) {
      this.toolNameByToolCallId.clear();
      this.isExplicitMode = false;
      this.activeStepIndex = undefined;
    }
    this.activePlanId = planId;
  }

  getActivePlanId(): string | undefined {
    return this.activePlanId;
  }

  /**
   * Stop tracking progress (called when user stops execution)
   */
  stop(): void {
    this.isStopped = true;
  }

  /**
   * Resume tracking progress
   */
  resume(): void {
    this.isStopped = false;
  }

  /**
   * Handle tool input available event
   * 
   * NOTE: Auto-tracking is DISABLED for plan-mode execution.
   * Progress is managed by the backend runStep function which calls writeStepStatus.
   */
  trackInput(toolCallId: string, toolName: string, input?: unknown): void {
    // Skip if stopped
    if (this.isStopped) return;

    this.toolNameByToolCallId.set(toolCallId, toolName);

    // Handle explicit progress updates - this is the primary mechanism
    if (toolName === DefaultToolName.Progress) {
      this.isExplicitMode = true;
      const progressInput = input as ProgressInput;

      if (this.activePlanId) {
        this.applyProgress(progressInput);
      }

      return;
    }

    if (!this.activePlanId) return;

    // Only record tool names for tracking purposes
    // Auto-start is disabled - backend controls progress
    if (this.isExplicitMode) {
      this.recordTool(toolName);
      return;
    }

    // AUTO-TRACKING DISABLED: Backend manages progress via writeStepStatus
    // Just record the tool for reference
    this.recordTool(toolName);
  }

  /**
   * Handle tool output available event
   * 
   * NOTE: Auto-completion is DISABLED for plan-mode execution.
   * Progress is managed by the backend runStep function which calls writeStepStatus.
   */
  trackOutput(
    toolCallId: string,
    output: unknown,
    isError: boolean = false,
  ): void {
    // Skip if stopped
    if (this.isStopped) return;

    const toolName = this.toolNameByToolCallId.get(toolCallId);
    if (!toolName) return;

    const isProgressTool = toolName === DefaultToolName.Progress;
    const isMetaTool =
      toolName === DefaultToolName.Outline ||
      toolName === DefaultToolName.Plan;

    // Progress tool output - already handled in handleToolInput
    if (isProgressTool) {
      return;
    }

    // Record step output for non-meta tools
    if (!isMetaTool && this.activePlanId) {
      this.recordStepOutput(toolName, output, isError);
    }

    // AUTO-COMPLETION DISABLED: Backend manages progress via writeStepStatus
    // The runStep function in route.ts controls when steps complete
  }

  /**
   * Apply explicit progress update from AI's progress tool call
   */
  private applyProgress(progressInput: ProgressInput): void {
    if (!this.activePlanId) return;

    const current = this.progressStore.get(this.activePlanId);
    if (!current) return;

    const stepIndex = progressInput.stepIndex;
    const status = progressInput.status;
    const newCurrentStepIndex = progressInput.currentStepIndex;

    if (stepIndex === undefined) {
      return;
    }

    while (current.steps.length <= stepIndex) {
      current.steps.push({
        status: "pending"
      });
    }

    const step = current.steps[stepIndex];
    if (!step) return;

    // Update step status
    if (status === "in_progress") {
      current.steps[stepIndex] = {
        ...step,
        status: "in_progress",
        startTime: step.startTime || Date.now(),
        toolCalls: step.toolCalls || [],
        actions: progressInput.actions ?? step.actions,
      };
      this.activeStepIndex = stepIndex;
    } else if (status === "completed") {
      current.steps[stepIndex] = {
        ...step,
        status: "completed",
        endTime: Date.now(),
        actions: progressInput.actions ?? step.actions,
      };
      if (this.activeStepIndex === stepIndex) this.activeStepIndex = undefined;

      // Record analytics
      const toolName = step.toolCalls?.[0];
      recordStepCompleted(this.activePlanId, stepIndex, toolName);
    } else if (status === "failed") {
      const errorMessage = this.readError(progressInput.actions);
      current.steps[stepIndex] = {
        ...step,
        status: "failed",
        endTime: Date.now(),
        errorMessage,
        actions: progressInput.actions ?? step.actions,
      };
      if (this.activeStepIndex === stepIndex) this.activeStepIndex = undefined;

      // Record analytics
      recordStepFailed(this.activePlanId, stepIndex, errorMessage || "Unknown error");
    }

    // Update current step index
    // If newCurrentStepIndex is explicitly provided, use it
    // If it's undefined and this is a completed step, check if it's the last step
    if (newCurrentStepIndex !== undefined) {
      current.currentStepIndex = newCurrentStepIndex;
    } else if (status === "completed") {
      // For the last step, currentStepIndex might be omitted
      // Check if this is indeed the last step
      const isLastStep = stepIndex === current.steps.length - 1;
      if (isLastStep) {
        current.currentStepIndex = undefined; // Mark as complete
      }
    }

    // Check if plan is complete
    const allStepsComplete = current.steps.every(
      (s) => s.status === "completed" || s.status === "failed"
    );

    if (allStepsComplete) {
      const hasFailures = current.steps.some((s) => s.status === "failed");
      if (hasFailures) {
        recordPlanFailed(this.activePlanId);
      } else {
        recordPlanCompleted(this.activePlanId);
      }
      this.activeStepIndex = undefined;
      current.currentStepIndex = undefined; // Ensure it's marked as complete
    }

    // Write progress update
    this.writeProgress(current);
  }

  /**
   * Record step output
   */
  private recordStepOutput(
    toolName: string,
    output: unknown,
    isError: boolean,
  ): void {
    if (!this.activePlanId) return;

    const current = this.progressStore.get(this.activePlanId);
    if (!current) return;

    const idx = this.selectStep(current);

    if (idx === undefined || idx === -1) return;

    this.dataStream.write({
      type: "data-plan-step-output",
      id: this.activePlanId,
      data: {
        planId: this.activePlanId,
        stepIndex: idx,
        toolName,
        output: isError ? `Error: ${output}` : output,
      },
    });
  }

  private selectStep(current: PlanProgressState): number | undefined {
    if (this.activeStepIndex !== undefined) return this.activeStepIndex;
    const inProgressIndex = current.steps.findIndex((s) => s.status === "in_progress");
    if (inProgressIndex !== -1) return inProgressIndex;
    return current.currentStepIndex;
  }

  private recordTool(toolName: string): void {
    if (!this.activePlanId) return;

    const current = this.progressStore.get(this.activePlanId);
    if (!current) return;

    const idx = this.selectStep(current);
    if (idx === undefined) return;

    const step = current.steps[idx];
    if (!step) return;
    if (step.status !== "in_progress") return;

    const toolCalls = step.toolCalls ?? [];
    toolCalls.push(toolName);
    step.toolCalls = toolCalls;
  }

  private readError(
    actions: Array<{ label: string; value?: string }> | undefined,
  ): string | undefined {
    if (!actions || actions.length === 0) return undefined;
    const labeled = actions.find((a) => a.label.toLowerCase() === "error");
    return labeled?.value ?? actions[0]?.value;
  }

  /**
   * Write progress update to stream
   */
  private writeProgress(progress: PlanProgressState): void {
    this.dataStream.write({
      type: "data-plan-progress",
      id: this.activePlanId,
      data: progress,
    });
  }

  /**
   * Get current progress state
   */
  getProgress(planId: string): PlanProgressState | undefined {
    return this.progressStore.get(planId);
  }

  /**
   * Get step timing metrics
   */
  getStepTiming(planId: string, stepIndex: number): {
    duration?: number;
    startTime?: number;
    endTime?: number;
  } {
    const progress = this.progressStore.get(planId);
    const step = progress?.steps[stepIndex];

    if (!step) return {};

    const duration =
      step.startTime && step.endTime
        ? step.endTime - step.startTime
        : undefined;

    return {
      duration,
      startTime: step.startTime,
      endTime: step.endTime,
    };
  }

  /**
   * Get total plan timing
   */
  getTotalTiming(planId: string): {
    totalDuration?: number;
    startTime?: number;
    endTime?: number;
  } {
    const progress = this.progressStore.get(planId);
    if (!progress) return {};

    const completedSteps = progress.steps.filter(
      (s) => s.status === "completed" || s.status === "failed",
    );

    if (completedSteps.length === 0) return {};

    const startTimes = completedSteps
      .map((s) => s.startTime)
      .filter((t): t is number => t !== undefined);
    const endTimes = completedSteps
      .map((s) => s.endTime)
      .filter((t): t is number => t !== undefined);

    const startTime = startTimes.length > 0 ? Math.min(...startTimes) : undefined;
    const endTime = endTimes.length > 0 ? Math.max(...endTimes) : undefined;

    const totalDuration =
      startTime && endTime ? endTime - startTime : undefined;

    return {
      totalDuration,
      startTime,
      endTime,
    };
  }
}
