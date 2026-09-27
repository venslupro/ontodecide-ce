/**
 * @fileoverview Zod schemas for situation REST inputs.
 */

import {z} from 'zod';
import {filterExprSchema} from '@ontodecide/shared-kernel';

const i18nText = z.union([z.string(), z.record(z.string(), z.string())]);

/** POST /automations and PUT /automations/{id} body. */
export const automationDefSchema = z
  .object({
    name: i18nText,
    trigger: z.enum(['threshold', 'schedule']),
    objectType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
    condition: filterExprSchema,
    everyHours: z.number().int().min(1).max(24).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    cooldownSec: z.number().int().min(0).max(86_400).default(3600),
    enabled: z.boolean().default(true),
  })
  .refine(d => d.trigger !== 'schedule' || d.everyHours !== undefined, {
    message: 'everyHours is required for schedule triggers',
    path: ['everyHours'],
  });

/** GET /alerts query. */
export const alertQuerySchema = z.object({
  status: z.enum(['OPEN', 'ACKED', 'CLOSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  rid: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
