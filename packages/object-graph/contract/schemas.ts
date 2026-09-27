/**
 * @fileoverview Zod schemas for object-graph REST inputs.
 */

import {z} from 'zod';

const rid = z.string().regex(/^ri\.[A-Za-z][A-Za-z0-9_]*\.[0-9A-Z]{26}$/);

/** RID path parameter. */
export const ridSchema = rid;

/** PATCH /objects/{rid} body (application/merge-patch+json). */
export const mergePatchSchema = z.record(z.string(), z.unknown());

/** POST /action-types/{id}/executions body. */
export const executeActionSchema = z.object({
  target: rid,
  params: z.record(z.string(), z.unknown()).default({}),
  recommendationId: z.string().optional(),
});

/** GET /objects/{rid}/links query. */
export const linksQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(2).default(1),
  linkTypes: z
    .string()
    .optional()
    .transform(v => (v ? v.split(',').filter(Boolean) : undefined)),
  direction: z.enum(['out', 'in', 'both']).default('both'),
  limit: z.coerce.number().int().min(1).max(300).default(200),
});
