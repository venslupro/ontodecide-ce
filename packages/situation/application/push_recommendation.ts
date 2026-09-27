/**
 * @fileoverview Stores the latest recommendation summary (and its impacted
 * objects) and pushes it to the cockpit.
 */

import {type CallCtx, parseOrThrow} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import type {RecommendationSummary} from '../contract/types';
import {META, type RoomRuntime} from './support';

const summarySchema = z
  .object({
    id: z.string().min(1).max(64),
    status: z.string().max(32),
    summary: z.string().max(4000),
    confidence: z.number(),
    rankedBy: z.enum(['ai', 'rules']),
    focus: z.string().max(200),
    expectedImpact: z.number(),
    createdAt: z.string(),
    expiresAt: z.string(),
    impacted: z
      .array(
        z.object({
          rid: z.string(),
          type: z.string(),
          title: z.string(),
          delta: z.number(),
          hop: z.number(),
        }),
      )
      .max(300)
      .optional(),
  })
  .loose();

/** Handles SituationRpc.pushRecommendation. */
export async function pushRecommendation(
  rt: RoomRuntime,
  ctx: CallCtx,
  rec: RecommendationSummary,
): Promise<void> {
  rt.touch(ctx);
  const parsed = parseOrThrow(summarySchema, rec) as RecommendationSummary;
  const stored: RecommendationSummary = {
    ...parsed,
    ...(parsed.impacted
      ? {
          impacted: [...parsed.impacted]
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 20),
        }
      : {}),
  };
  rt.deps.store.setMeta(META.recommendation, JSON.stringify(stored));
  rt.push('recommendation', stored);
}
