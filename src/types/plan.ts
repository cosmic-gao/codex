import { z } from "zod";

export const PlanActionSchema = z.object({
  label: z.string(),
  value: z.string().optional(),
});

export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PlanStepSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  actions: z.array(PlanActionSchema).optional(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanToolOutputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  steps: z.array(PlanStepSchema).default([]),
});

export type PlanToolOutput = z.infer<typeof PlanToolOutputSchema>;

export const PlanDataPartSchema = z.object({
  type: z.literal("data-plan"),
  id: z.string().optional(),
  data: PlanToolOutputSchema,
});

export type PlanDataPart = z.infer<typeof PlanDataPartSchema>;

export const PlanProgressStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

export type PlanProgressStatus = z.infer<typeof PlanProgressStatusSchema>;

export const PlanProgressStepSchema = z.object({
  status: PlanProgressStatusSchema,
});

export type PlanProgressStep = z.infer<typeof PlanProgressStepSchema>;

export const PlanProgressSchema = z.object({
  planId: z.string(),
  steps: z.array(PlanProgressStepSchema),
  currentStepIndex: z.number().int().nonnegative().optional(),
});

export type PlanProgress = z.infer<typeof PlanProgressSchema>;

export const PlanProgressDataPartSchema = z.object({
  type: z.literal("data-plan-progress"),
  id: z.string().optional(),
  data: PlanProgressSchema,
});

export type PlanProgressDataPart = z.infer<typeof PlanProgressDataPartSchema>;
