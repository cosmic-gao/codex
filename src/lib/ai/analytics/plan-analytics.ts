/**
 * Plan mode analytics
 *
 * @description
 * Track plan mode effectiveness and performance metrics for monitoring
 * and continuous improvement.
 */

export interface PlanAnalyticsEvent {
  eventType:
    | "plan_created"
    | "plan_started"
    | "plan_completed"
    | "plan_failed"
    | "plan_cancelled"
    | "step_started"
    | "step_completed"
    | "step_failed";
  planId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface PlanMetrics {
  planId: string;
  title: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  totalDuration?: number;
  averageStepDuration?: number;
  toolsUsed: string[];
  createdAt: number;
  completedAt?: number;
  status: "in_progress" | "completed" | "failed" | "cancelled";
}

export class PlanAnalytics {
  private events: PlanAnalyticsEvent[] = [];
  private metrics: Map<string, PlanMetrics> = new Map();

  /**
   * Record an analytics event
   */
  recordEvent(event: PlanAnalyticsEvent): void {
    this.events.push(event);

    // Update metrics based on event
    this.updateMetrics(event);
  }

  /**
   * Update metrics based on event
   */
  private updateMetrics(event: PlanAnalyticsEvent): void {
    const metrics = this.metrics.get(event.planId);

    if (!metrics) {
      if (event.eventType === "plan_created") {
        this.metrics.set(event.planId, {
          planId: event.planId,
          title: (event.metadata?.title as string) || "Untitled Plan",
          totalSteps: (event.metadata?.totalSteps as number) || 0,
          completedSteps: 0,
          failedSteps: 0,
          toolsUsed: [],
          createdAt: event.timestamp,
          status: "in_progress",
        });
      }
      return;
    }

    // Update metrics based on event type
    switch (event.eventType) {
      case "step_completed":
        metrics.completedSteps++;
        if (event.metadata?.toolName) {
          const toolName = event.metadata.toolName as string;
          if (!metrics.toolsUsed.includes(toolName)) {
            metrics.toolsUsed.push(toolName);
          }
        }
        break;

      case "step_failed":
        metrics.failedSteps++;
        break;

      case "plan_completed":
        metrics.status = "completed";
        metrics.completedAt = event.timestamp;
        metrics.totalDuration = event.timestamp - metrics.createdAt;
        if (metrics.completedSteps > 0) {
          metrics.averageStepDuration =
            metrics.totalDuration / metrics.completedSteps;
        }
        break;

      case "plan_failed":
        metrics.status = "failed";
        metrics.completedAt = event.timestamp;
        metrics.totalDuration = event.timestamp - metrics.createdAt;
        break;

      case "plan_cancelled":
        metrics.status = "cancelled";
        metrics.completedAt = event.timestamp;
        metrics.totalDuration = event.timestamp - metrics.createdAt;
        break;
    }
  }

  /**
   * Get metrics for a specific plan
   */
  getPlanMetrics(planId: string): PlanMetrics | undefined {
    return this.metrics.get(planId);
  }

  /**
   * Get all plan metrics
   */
  getAllMetrics(): PlanMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get aggregated statistics
   */
  getAggregatedStats(): {
    totalPlans: number;
    completedPlans: number;
    failedPlans: number;
    cancelledPlans: number;
    averageCompletionRate: number;
    averagePlanDuration: number;
    mostUsedTools: Array<{ tool: string; count: number }>;
    averageStepsPerPlan: number;
  } {
    const allMetrics = this.getAllMetrics();

    if (allMetrics.length === 0) {
      return {
        totalPlans: 0,
        completedPlans: 0,
        failedPlans: 0,
        cancelledPlans: 0,
        averageCompletionRate: 0,
        averagePlanDuration: 0,
        mostUsedTools: [],
        averageStepsPerPlan: 0,
      };
    }

    const completedPlans = allMetrics.filter(
      (m) => m.status === "completed",
    ).length;
    const failedPlans = allMetrics.filter((m) => m.status === "failed").length;
    const cancelledPlans = allMetrics.filter(
      (m) => m.status === "cancelled",
    ).length;

    // Calculate average completion rate
    const completionRates = allMetrics
      .filter((m) => m.totalSteps > 0)
      .map((m) => m.completedSteps / m.totalSteps);
    const averageCompletionRate =
      completionRates.length > 0
        ? completionRates.reduce((a, b) => a + b, 0) / completionRates.length
        : 0;

    // Calculate average plan duration
    const durations = allMetrics
      .filter((m) => m.totalDuration !== undefined)
      .map((m) => m.totalDuration!);
    const averagePlanDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    // Calculate most used tools
    const toolCounts = new Map<string, number>();
    allMetrics.forEach((m) => {
      m.toolsUsed.forEach((tool) => {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      });
    });
    const mostUsedTools = Array.from(toolCounts.entries())
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate average steps per plan
    const averageStepsPerPlan =
      allMetrics.reduce((sum, m) => sum + m.totalSteps, 0) / allMetrics.length;

    return {
      totalPlans: allMetrics.length,
      completedPlans,
      failedPlans,
      cancelledPlans,
      averageCompletionRate,
      averagePlanDuration,
      mostUsedTools,
      averageStepsPerPlan,
    };
  }

  /**
   * Export analytics data
   */
  export(): {
    events: PlanAnalyticsEvent[];
    metrics: PlanMetrics[];
    stats: ReturnType<PlanAnalytics["getAggregatedStats"]>;
  } {
    return {
      events: this.events,
      metrics: this.getAllMetrics(),
      stats: this.getAggregatedStats(),
    };
  }

  /**
   * Clear all analytics data
   */
  clear(): void {
    this.events = [];
    this.metrics.clear();
  }

  /**
   * Get events for a specific plan
   */
  getPlanEvents(planId: string): PlanAnalyticsEvent[] {
    return this.events.filter((e) => e.planId === planId);
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 100): PlanAnalyticsEvent[] {
    return this.events.slice(-limit);
  }
}

// Global analytics instance
export const globalPlanAnalytics = new PlanAnalytics();

/**
 * Helper function to record plan creation
 */
export function recordPlanCreated(
  planId: string,
  title: string,
  totalSteps: number,
): void {
  globalPlanAnalytics.recordEvent({
    eventType: "plan_created",
    planId,
    timestamp: Date.now(),
    metadata: { title, totalSteps },
  });
}

/**
 * Helper function to record plan completion
 */
export function recordPlanCompleted(planId: string): void {
  globalPlanAnalytics.recordEvent({
    eventType: "plan_completed",
    planId,
    timestamp: Date.now(),
  });
}

/**
 * Helper function to record plan failure
 */
export function recordPlanFailed(planId: string, error?: string): void {
  globalPlanAnalytics.recordEvent({
    eventType: "plan_failed",
    planId,
    timestamp: Date.now(),
    metadata: { error },
  });
}

/**
 * Helper function to record step completion
 */
export function recordStepCompleted(
  planId: string,
  stepIndex: number,
  toolName?: string,
): void {
  globalPlanAnalytics.recordEvent({
    eventType: "step_completed",
    planId,
    timestamp: Date.now(),
    metadata: { stepIndex, toolName },
  });
}

/**
 * Helper function to record step failure
 */
export function recordStepFailed(
  planId: string,
  stepIndex: number,
  error?: string,
): void {
  globalPlanAnalytics.recordEvent({
    eventType: "step_failed",
    planId,
    timestamp: Date.now(),
    metadata: { stepIndex, error },
  });
}
