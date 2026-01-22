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
  private isExplicitProgress: boolean;
  private stepIndexForOutput?: number;
  private stepToolCallCount: Map<number, number>;

  constructor(
    progressStore: Map<string, PlanProgressState>,
    dataStream: UIMessageStreamWriter,
  ) {
    this.progressStore = progressStore;
    this.dataStream = dataStream;
    this.toolNameByToolCallId = new Map();
    this.isExplicitProgress = false;
    this.stepToolCallCount = new Map();
  }

  setActivePlanId(planId: string): void {
    this.activePlanId = planId;
  }

  getActivePlanId(): string | undefined {
    return this.activePlanId;
  }

  /**
   * Handle tool input available event
   */
  handleToolInput(toolCallId: string, toolName: string, input?: unknown): void {
    this.toolNameByToolCallId.set(toolCallId, toolName);

    // Handle explicit progress updates
    if (toolName === DefaultToolName.Progress) {
      this.isExplicitProgress = true;
      const progressInput = input as ProgressInput;

      if (typeof progressInput?.currentStepIndex === "number") {
        this.stepIndexForOutput = progressInput.currentStepIndex;
      } else if (typeof progressInput?.stepIndex === "number") {
        this.stepIndexForOutput = progressInput.stepIndex;
      }

      // Don't auto-update if explicit progress is being used
      return;
    }

    // Auto-detect step start
    if (!this.isExplicitProgress && this.activePlanId) {
      this.autoStartStep(toolName);
    }
  }

  /**
   * Handle tool output available event
   */
  handleToolOutput(
    toolCallId: string,
    output: unknown,
    isError: boolean = false,
  ): void {
    const toolName = this.toolNameByToolCallId.get(toolCallId);
    if (!toolName) return;

    const isProgressTool = toolName === DefaultToolName.Progress;
    const isMetaTool =
      toolName === DefaultToolName.Outline ||
      toolName === DefaultToolName.Plan;

    // Record step output
    if (!isProgressTool && !isMetaTool && this.activePlanId) {
      this.recordStepOutput(toolName, output, isError);
    }

    // Auto-complete step
    if (!isProgressTool && !this.isExplicitProgress && this.activePlanId) {
      this.autoCompleteStep(isError, output);
    }
  }

  /**
   * Auto-detect step start based on tool calls
   */
  private autoStartStep(toolName: string): void {
    if (!this.activePlanId) return;

    const current = this.progressStore.get(this.activePlanId);
    if (!current || current.currentStepIndex === undefined) return;

    const idx = current.currentStepIndex;
    const step = current.steps[idx];

    if (step?.status === "pending") {
      // Mark step as in progress
      current.steps[idx] = {
        ...step,
        status: "in_progress",
        startTime: Date.now(),
        toolCalls: [toolName],
      };

      this.stepToolCallCount.set(idx, 1);

      this.writeProgress(current);
    } else if (step?.status === "in_progress") {
      // Track additional tool calls
      const count = this.stepToolCallCount.get(idx) ?? 0;
      this.stepToolCallCount.set(idx, count + 1);

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
    if (current?.currentStepIndex === undefined) return;

    const idx = current.currentStepIndex;
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
      if (current) {
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
        }

        // Move to next step if not failed
        if (!isError) {
          const nextIndex =
            idx + 1 < current.steps.length ? idx + 1 : undefined;
          current.currentStepIndex = nextIndex;

          // Pre-mark next step as in_progress if it exists
          if (nextIndex !== undefined) {
            const nextStep = current.steps[nextIndex];
            if (nextStep?.status === "pending") {
              current.steps[nextIndex] = {
                ...nextStep,
                status: "in_progress",
                startTime: Date.now(),
              };
            }
          }
        } else {
          // Stop execution on failure
          current.currentStepIndex = undefined;
        }

        this.stepToolCallCount.delete(idx);
        this.writeProgress(current);
      }
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
    const idx = this.stepIndexForOutput ?? current?.currentStepIndex;

    if (idx === undefined) return;

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
