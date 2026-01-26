import { describe, expect, test } from "vitest";
import { ProgressWriter } from "./progress-writer";
import { PlanProgress } from "app-types/plan";

describe("ProgressWriter", () => {
  test("initializes plan with snapshot", () => {
    const planId = "plan-init";
    const store = new Map<string, PlanProgress>();
    const writes: unknown[] = [];
    const dataStream = { write: (chunk: unknown) => writes.push(chunk) } as any;

    const writer = new ProgressWriter(store, dataStream);
    
    writer.writeSnapshot(planId, { title: "Test Plan", steps: [{}, {}] }, "data-plan");

    const current = store.get(planId)!;
    expect(current.steps).toHaveLength(2);
    expect(current.steps[0].status).toBe("pending");
    expect(writes).toContainEqual(expect.objectContaining({ type: "data-plan" }));
    expect(writes).toContainEqual(expect.objectContaining({ type: "data-plan-progress" }));
  });

  test("updates step status and advances current index", () => {
    const planId = "plan-update";
    const store = new Map<string, PlanProgress>();
    store.set(planId, {
      planId,
      steps: [{ status: "pending" }, { status: "pending" }],
      currentStepIndex: 0,
    });
    const dataStream = { write: () => {} } as any;
    const writer = new ProgressWriter(store, dataStream);

    // Start step 0
    writer.writeStepStatus({ planId, stepIndex: 0, status: "in_progress" });
    expect(store.get(planId)!.steps[0].status).toBe("in_progress");
    expect(store.get(planId)!.currentStepIndex).toBe(0);

    // Complete step 0
    writer.writeStepStatus({ planId, stepIndex: 0, status: "completed" });
    expect(store.get(planId)!.steps[0].status).toBe("completed");
    expect(store.get(planId)!.currentStepIndex).toBe(1); // Auto-advance
  });

  test("expands steps array if index out of bounds", () => {
    const planId = "plan-expand";
    const store = new Map<string, PlanProgress>();
    store.set(planId, { planId, steps: [] });
    const dataStream = { write: () => {} } as any;
    const writer = new ProgressWriter(store, dataStream);

    writer.writeStepStatus({ planId, stepIndex: 2, status: "in_progress" });

    const current = store.get(planId)!;
    expect(current.steps).toHaveLength(3);
    expect(current.steps[2].status).toBe("in_progress");
  });

  test("handles failure and clears current index", () => {
    const planId = "plan-fail";
    const store = new Map<string, PlanProgress>();
    store.set(planId, {
      planId,
      steps: [{ status: "in_progress" }],
      currentStepIndex: 0,
    });
    const dataStream = { write: () => {} } as any;
    const writer = new ProgressWriter(store, dataStream);

    writer.writeStepStatus({ 
      planId, 
      stepIndex: 0, 
      status: "failed", 
      errorMessage: "boom" 
    });

    const current = store.get(planId)!;
    expect(current.steps[0].status).toBe("failed");
    expect(current.steps[0].errorMessage).toBe("boom");
    expect(current.currentStepIndex).toBeUndefined();
  });
});
