/**
 * @fileoverview Zod schemas for decision REST inputs.
 */

import {z} from 'zod';
import {DECISION_LIMITS} from './types';

const rid = z.string().startsWith('ri.');

export const perturbationSchema = z.object({
  rid,
  property: z.string().min(1),
  change: z.number().min(-1).max(1),
});

export const scenarioInputSchema = z.object({
  name: z.string().max(100).optional(),
  perturbations: z
    .array(perturbationSchema)
    .min(1)
    .max(DECISION_LIMITS.perturbationsMax),
  candidateActions: z
    .array(
      z.object({
        actionType: z.string(),
        target: rid,
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(10)
    .optional(),
});

export const runScenarioInputSchema = scenarioInputSchema.partial({
  perturbations: true,
});

export const candidateActionsInputSchema = z.object({
  perturbations: z
    .array(perturbationSchema)
    .min(1)
    .max(DECISION_LIMITS.perturbationsMax),
});

export const generateRecommendationInputSchema = z.object({
  alertId: z.string().optional(),
  scenarioId: z.string().optional(),
  focus: rid,
  locale: z.enum(['zh-CN', 'en-US']).optional(),
});

export const rejectInputSchema = z.object({reason: z.string().min(1).max(500)});

export const feedbackInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export const suggestMappingInputSchema = z.object({
  fields: z.array(z.string()).min(1).max(200),
  rows: z.array(z.array(z.unknown())).max(20),
  targetType: z.string().min(1),
});
