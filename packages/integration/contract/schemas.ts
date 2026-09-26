/**
 * @fileoverview Zod schemas for data integration REST inputs.
 */

import {z} from 'zod';
import {INGEST_LIMITS} from './types';

const transform = z.string().max(200).optional();

export const mappingSpecSchema = z.object({
  targetType: z.string().min(1),
  primaryKey: z.object({from: z.string().min(1), transform}),
  fields: z.array(
    z.object({to: z.string().min(1), from: z.string().min(1), transform}),
  ),
  links: z
    .array(
      z.object({
        type: z.string(),
        toType: z.string(),
        toKey: z.string(),
        split: z.string().optional(),
        weightFrom: z.string().optional(),
      }),
    )
    .optional(),
  sourceTsFrom: z.string().optional(),
});

export const qualityRuleSchema = z.object({
  prop: z.string(),
  kind: z.enum(['required', 'range', 'format', 'ref', 'freshness']),
  arg: z.unknown().optional(),
  onFail: z.enum(['reject', 'clamp', 'defer']),
});

export const sourceDefSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['file', 'rest', 'webhook']),
  config: z.record(z.string(), z.unknown()).default({}),
  mapping: mappingSpecSchema,
  qualityRules: z.array(qualityRuleSchema).max(50).optional(),
  conflictPolicy: z
    .enum(['latest-wins', 'source-priority', 'max-confidence'])
    .optional(),
  priority: z.number().int().min(0).max(100).optional(),
  schedule: z.string().max(50).optional(),
  enabled: z.boolean().optional(),
});

export const batchInputSchema = z.object({
  jobId: z.string().optional(),
  seq: z.number().int().min(0),
  last: z.boolean(),
  records: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(INGEST_LIMITS.batchRecordsMax),
  txnType: z.enum(['APPEND', 'SNAPSHOT']).optional(),
});

export const presignInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  bytes: z.number().int().min(1).max(INGEST_LIMITS.fileBytesMax),
});

export const replayInputSchema = z
  .object({
    fixes: z
      .array(
        z.object({id: z.string(), payload: z.record(z.string(), z.unknown())}),
      )
      .optional(),
  })
  .default({});
