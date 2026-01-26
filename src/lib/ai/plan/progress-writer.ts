import { PlanProgress, PlanProgressStep } from "app-types/plan";
import type { UIMessageStreamWriter } from "ai";
import globalLogger from "logger";
import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Plan Progress: `),
});

type DataStreamWriter = UIMessageStreamWriter;

/**
 * Authoritative writer for plan progress state.
 * Ensures monotonic state transitions and handles persistence to the store and stream.
 */
export class ProgressWriter {
  private store: Map<string, PlanProgress>;
  private dataStream: DataStreamWriter;
  private emittedPlanIds = new Set<string>();

  constructor(
    store: Map<string, PlanProgress>,
    dataStream: DataStreamWriter
  ) {
    this.store = store;
    this.dataStream = dataStream;
  }

  /**
   * Initialize a new plan snapshot in the store and stream it.
   */
  writeSnapshot(planId: string, planData: any, type: "data-outline" | "data-plan") {
    if (this.emittedPlanIds.has(planId)) return;
    this.emittedPlanIds.add(planId);

    const steps: PlanProgressStep[] = (planData.steps ?? []).map(() => ({
      status: "pending",
      actions: undefined,
      startTime: undefined,
      endTime: undefined,
      toolCalls: undefined,
      errorMessage: undefined,
    }));

    const snapshot: PlanProgress = {
      planId,
      steps,
      currentStepIndex: steps.length ? 0 : undefined,
    };

    this.store.set(planId, snapshot);

    this.dataStream.write({
      type,
      id: planId,
      data: planData,
    });

    this.dataStream.write({
      type: "data-plan-progress",
      id: planId,
      data: snapshot,
    });
  }

  /**
   * Update the status of a specific step.
   * Handles state transitions, timing, and current step index updates.
   */
  writeStepStatus(payload: {
    planId: string;
    stepIndex: number;
    status: "in_progress" | "completed" | "failed";
    errorMessage?: string;
  }) {
    const current = this.store.get(payload.planId);
    if (!current) {
      logger.error(`Plan ${payload.planId} not found in store`);
      return;
    }

    // Ensure steps array is large enough
    while (current.steps.length <= payload.stepIndex) {
      current.steps.push({
        status: "pending",
        actions: undefined,
        startTime: undefined,
        endTime: undefined,
        toolCalls: undefined,
        errorMessage: undefined,
      });
    }

    const prev = current.steps[payload.stepIndex];
    const now = Date.now();

    logger.info(`Status transition: Step ${payload.stepIndex} ${prev.status} -> ${payload.status}`);

    if (payload.status === "in_progress") {
      // Clear other in-progress steps to ensure single active step
      for (let i = 0; i < current.steps.length; i++) {
        if (i === payload.stepIndex) continue;
        if (current.steps[i].status === "in_progress") {
           logger.warn(`Clearing stale in-progress step ${i}`);
           current.steps[i] = {
             ...current.steps[i],
             status: "pending",
             startTime: undefined,
             endTime: undefined
           };
        }
      }

      // Determine start time (inherit from previous step's end time if available)
      let startTime = now;
      if (payload.stepIndex > 0) {
        const prevStep = current.steps[payload.stepIndex - 1];
        if (prevStep?.endTime) {
          startTime = prevStep.endTime;
        }
      }

      current.steps[payload.stepIndex] = {
        ...prev,
        status: "in_progress",
        startTime,
        endTime: undefined,
        errorMessage: undefined,
      };
      current.currentStepIndex = payload.stepIndex;

    } else if (payload.status === "completed") {
      current.steps[payload.stepIndex] = {
        ...prev,
        status: "completed",
        endTime: now,
        errorMessage: undefined,
      };
      
      // Advance to next step index if available
      const nextIndex = payload.stepIndex + 1 < current.steps.length 
        ? payload.stepIndex + 1 
        : undefined;
      current.currentStepIndex = nextIndex;

    } else {
      // Failed
      current.steps[payload.stepIndex] = {
        ...prev,
        status: "failed",
        endTime: now,
        errorMessage: payload.errorMessage,
      };
      // On failure, we might want to stop or stay on current index.
      // Setting undefined indicates the plan flow is broken/stopped.
      current.currentStepIndex = undefined;
    }

    this.store.set(payload.planId, current);

    this.dataStream.write({
      type: "data-plan-progress",
      id: payload.planId,
      data: current,
    });
  }

  /**
   * Write a step output (tool output or assistant message) to the stream.
   */
  writeStepOutput(payload: {
    planId: string;
    stepIndex: number;
    toolName: string;
    output: unknown;
  }) {
    this.dataStream.write({
      type: "data-plan-step-output",
      id: payload.planId,
      data: payload,
    });
  }

  /**
   * Write raw data to the stream (e.g. for forwarding standard AI SDK parts).
   */
  writeRaw(value: Parameters<DataStreamWriter["write"]>[0]) {
    this.dataStream.write(value);
  }
}
