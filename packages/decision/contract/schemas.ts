/**
 * @fileoverview Zod schemas for decision REST inputs and the AI output.
 */

import {z} from 'zod';

const rid = z.string().regex(/^ri\.[A-Za-z][A-Za-z0-9_]*\.[0-9A-Z]{26}$/);

/** POST /scenarios body. */
export const scenarioInputSchema = z.object({
  name: z.string().max(120).optional(),
  perturbations: z
    .array(
      z.object({
        rid,
        property: z.string().min(1),
        change: z.number().min(-1).max(1),
      }),
    )
    .min(1)
    .max(10),
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

/** POST /recommendations body. */
export const generateInputSchema = z.object({
  focus: rid,
  alertId: z.string().optional(),
  scenarioId: z.string().optional(),
});

/** POST /recommendations/{id}/decision body. */
export const decisionInputSchema = z
  .object({
    decision: z.enum(['confirm', 'reject']),
    reason: z.string().max(500).optional(),
  })
  .refine(d => d.decision !== 'reject' || !!d.reason, {
    message: 'reason is required to reject',
    path: ['reason'],
  });

/**
 * AI ranking output (详细设计 6.11.5). The same JSON Schema is the function
 * definition given to the model; there is no free-form parameter field.
 * Extra checks: ranking ⊆ candidate ids without duplicates; evidence rid/prop
 * must appear in the input subgraph.
 */
export const rankingSchema = z
  .object({
    ranking: z.array(z.string()).min(1).max(3),
    summary: z.string().max(160),
    rationale: z.string().max(800),
    risks: z.array(z.string().max(160)).max(5),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.object({rid: z.string(), prop: z.string()})).min(1),
  })
  .strict();

/** Parsed AI ranking. */
export type AiRanking = z.infer<typeof rankingSchema>;
