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
  private stepToolCallCount: Map<number, number>;
  private isStopped: boolean;

  constructor(
    progressStore: Map<string, PlanProgressState>,
    dataStream: UIMessageStreamWriter,
  ) {
    this.progressStore = progressStore;
    this.dataStream = dataStream;
    this.toolNameByToolCallId = new Map();
    this.isExplicitMode = false;
    this.stepToolCallCount = new Map();
    this.isStopped = false;
  }

  setActivePlanId(planId: string): void {
    if (this.activePlanId && this.activePlanId !== planId) {
      this.toolNameByToolCallId.clear();
      this.stepToolCallCount.clear();
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

    if (this.isExplicitMode) {
      this.recordTool(toolName);
      return;
    }

    this.autoStartStep(toolName);
  }

  /**
   * Handle tool output available event
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

    // Auto-complete step (only for non-progress, non-meta tools)
    // This is the fallback mechanism when AI doesn't use progress tool
    if (!isMetaTool && this.activePlanId && !this.isExplicitMode) {
      this.autoCompleteStep(isError, output);
    }
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
      current.steps.push({ status: "pending" });
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

    // Update current step index if provided
    if (newCurrentStepIndex !== undefined) {
      current.currentStepIndex = newCurrentStepIndex;
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
    }

    // Write progress update
    this.writeProgress(current);
  }

  /**
   * Auto-detect step start based on tool calls
   * Intelligently determines which step should be started based on current state
   */
  private autoStartStep(toolName: string): void {
    if (!this.activePlanId) return;

    const current = this.progressStore.get(this.activePlanId);
    if (!current) return;

    // Find the next step that should be started
    let targetStepIndex: number | undefined;

    // First, check if there's already an in-progress step
    const inProgressIndex = current.steps.findIndex(s => s.status === "in_progress");
    
    if (inProgressIndex !== -1) {
      // Continue with the current in-progress step
      targetStepIndex = inProgressIndex;
    } else {
      // Find the first pending step
      const nextPendingIndex = current.steps.findIndex(s => s.status === "pending");
      
      if (nextPendingIndex !== -1) {
        // Start the next pending step
        targetStepIndex = nextPendingIndex;
      }
    }

    if (targetStepIndex === undefined) return;

    const step = current.steps[targetStepIndex];
    if (!step) return;

    if (step.status === "pending") {
      // Mark step as in progress
      current.steps[targetStepIndex] = {
        ...step,
        status: "in_progress",
        startTime: Date.now(),
        toolCalls: [toolName],
      };

      this.stepToolCallCount.set(targetStepIndex, 1);
      
      // Update currentStepIndex to match
      current.currentStepIndex = targetStepIndex;

      this.writeProgress(current);
    } else if (step.status === "in_progress") {
      // Track additional tool calls for the current step
      const count = this.stepToolCallCount.get(targetStepIndex) ?? 0;
      this.stepToolCallCount.set(targetStepIndex, count + 1);

      if (step.toolCalls) {
        step.toolCalls.push(toolName);
      }
    }
  }

  /**
   * Auto-complete step based on tool output
   */
  private autoCompleteStep(isError: boolean, output?: unknown): void {
    if (!this.activePlanId) return;

    const current = this.progressStore.get(this.activePlanId);
    if (!current) return;

    // Find the current in-progress step
    const idx = current.steps.findIndex(s => s.status === "in_progress");
    
    if (idx === -1) return; // No in-progress step to complete

    const step = current.steps[idx];
    if (!step) return;

    // Determine if step should be completed
    const shouldComplete = this.shouldCompleteStep(idx, isError);

    if (shouldComplete) {
      const status = isError ? "failed" : "completed";
      const endTime = Date.now();

      current.steps[idx] = {
        ...step,
        status,
        endTime,
        errorMessage: isError ? String(output) : undefined,
      };

      // Record analytics
      if (isError) {
        recordStepFailed(this.activePlanId, idx, String(output));
      } else {
        const toolName = step.toolCalls?.[0];
        recordStepCompleted(this.activePlanId, idx, toolName);
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
        console.log(`[PlanProgressTracker] Plan completed. Has failures: ${hasFailures}`);
      }

      // Update currentStepIndex for next step
      if (!isError) {
        const nextIndex = idx + 1 < current.steps.length ? idx + 1 : undefined;
        current.currentStepIndex = nextIndex;
        
        // Don't pre-mark next step - let autoStartStep handle it on next tool call
      } else {
        // Stop execution on failure
        current.currentStepIndex = undefined;
      }

      this.stepToolCallCount.delete(idx);
      this.writeProgress(current);
    }
  }

  /**
   * Determine if step should be completed
   */
  private shouldCompleteStep(stepIndex: number, isError: boolean): boolean {
    if (isError) return true; // Always complete on error

    const toolCallCount = this.stepToolCallCount.get(stepIndex) ?? 0;

    // Simple heuristic: complete if at least one tool call succeeded
    // In the future, could use complexity score to determine threshold
    return toolCallCount >= 1;
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
