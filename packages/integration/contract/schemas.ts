/**
 * @fileoverview Zod schemas for data-integration REST inputs.
 */

import {z} from 'zod';

const apiName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const transform = z.string().max(200).optional();

/** MappingSpec. */
export const mappingSpecSchema = z.object({
  targetType: apiName,
  primaryKey: z.object({from: z.string().min(1), transform}),
  fields: z
    .array(
      z.object({
        to: apiName,
        from: z.string().min(1),
        transform,
        matchedBy: z
          .enum(['exact', 'synonym', 'similarity', 'ai', 'manual'])
          .optional(),
      }),
    )
    .max(100),
  links: z
    .array(
      z.object({
        type: apiName,
        toType: apiName,
        toKey: z.string().min(1),
        split: z.string().max(4).optional(),
        weightFrom: z.string().optional(),
      }),
    )
    .max(10)
    .optional(),
});

/** POST /imports body. */
export const createImportSchema = z.object({
  fileName: z.string().min(1).max(200),
  targetType: apiName,
  totalRows: z.number().int().min(1).max(2000),
  mapping: mappingSpecSchema.optional(),
});

/** PUT /imports/{id}/mapping body. */
export const putMappingSchema = z.object({mapping: mappingSpecSchema});

/** POST /imports/{id}/batches body. */
export const batchSchema = z.object({
  seq: z.number().int().min(0).max(10_000),
  last: z.boolean(),
  rows: z.array(z.record(z.string(), z.unknown())).min(0).max(100),
});

/** POST /imports/{id}/mapping-draft body. */
export const mappingDraftSchema = z.object({
  fields: z.array(z.string().max(200)).min(1).max(100),
  sampleRows: z.array(z.array(z.unknown())).max(20),
  targetType: apiName,
});
