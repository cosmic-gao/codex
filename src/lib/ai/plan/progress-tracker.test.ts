import { describe, expect, test } from "vitest";
import { PlanProgressTracker, PlanProgressState } from "./progress-tracker";

describe("PlanProgressTracker", () => {
  test("does not auto-complete steps in explicit progress mode", () => {
    const planId = "plan-1";
    const store = new Map<string, PlanProgressState>();
    store.set(planId, {
      planId,
      steps: [{ status: "pending" }, { status: "pending" }],
      currentStepIndex: 0,
    });

    const writes: unknown[] = [];
    const dataStream = { write: (chunk: unknown) => writes.push(chunk) } as any;

    const tracker = new PlanProgressTracker(store, dataStream);
    tracker.setActivePlanId(planId);

    tracker.trackInput("p1", "progress", {
      planId,
      stepIndex: 0,
      status: "in_progress",
      currentStepIndex: 0,
    });

    tracker.trackInput("t1", "search", {});
    tracker.trackOutput("t1", { ok: true }, false);

    const current = store.get(planId)!;
    expect(current.steps[0]?.status).toBe("in_progress");
    expect(current.steps[0]?.endTime).toBeUndefined();
    expect(current.steps[0]?.toolCalls).toEqual(["search"]);
  });

  test("expands steps when explicit progress arrives before snapshot", () => {
    const planId = "plan-2";
    const store = new Map<string, PlanProgressState>();
    store.set(planId, { planId, steps: [] });

    const dataStream = { write: () => {} } as any;
    const tracker = new PlanProgressTracker(store, dataStream);
    tracker.setActivePlanId(planId);

    tracker.trackInput("p1", "progress", {
      planId,
      stepIndex: 2,
      status: "in_progress",
      currentStepIndex: 2,
    });

    const current = store.get(planId)!;
    expect(current.steps).toHaveLength(3);
    expect(current.steps[2]?.status).toBe("in_progress");
  });

  test("stores errorMessage from error actions on failed progress", () => {
    const planId = "plan-3";
    const store = new Map<string, PlanProgressState>();
    store.set(planId, {
      planId,
      steps: [{ status: "pending" }],
      currentStepIndex: 0,
    });

    const dataStream = { write: () => {} } as any;
    const tracker = new PlanProgressTracker(store, dataStream);
    tracker.setActivePlanId(planId);

    tracker.trackInput("p1", "progress", {
      planId,
      stepIndex: 0,
      status: "failed",
      actions: [{ label: "error", value: "boom" }],
    });

    const current = store.get(planId)!;
    expect(current.steps[0]?.status).toBe("failed");
    expect(current.steps[0]?.errorMessage).toBe("boom");
  });
});

