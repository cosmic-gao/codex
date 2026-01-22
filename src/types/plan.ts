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
  actions: z.array(PlanActionSchema).optional(),
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

export const OutlineStepSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
});

export type OutlineStep = z.infer<typeof OutlineStepSchema>;

export const OutlineToolOutputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  steps: z.array(OutlineStepSchema).default([]),
});

export type OutlineToolOutput = z.infer<typeof OutlineToolOutputSchema>;

export const OutlineDataPartSchema = z.object({
  type: z.literal("data-outline"),
  id: z.string().optional(),
  data: OutlineToolOutputSchema,
});

export type OutlineDataPart = z.infer<typeof OutlineDataPartSchema>;

export const PlanStepOutputSchema = z.object({
  planId: z.string(),
  stepIndex: z.number(),
  toolName: z.string(),
  output: z.unknown(),
});

export type PlanStepOutput = z.infer<typeof PlanStepOutputSchema>;

export const PlanStepOutputDataPartSchema = z.object({
  type: z.literal("data-plan-step-output"),
  id: z.string().optional(),
  data: PlanStepOutputSchema,
});

export type PlanStepOutputDataPart = z.infer<typeof PlanStepOutputDataPartSchema>;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};
