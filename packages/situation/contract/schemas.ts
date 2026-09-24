/**
 * @fileoverview Zod schemas for situation awareness REST inputs.
 */

import {z} from 'zod';

const i18nText = z.union([z.string().min(1), z.record(z.string(), z.string())]);
const filterExpr = z.record(z.string(), z.unknown());
const objectSetDef = z.object({
  objectType: z.string().min(1),
  filter: filterExpr.optional(),
  searchAround: z
    .array(z.object({link: z.string(), direction: z.enum(['out', 'in'])}))
    .optional(),
  orderBy: z
    .array(z.object({prop: z.string(), dir: z.enum(['asc', 'desc'])}))
    .optional(),
});

export const kpiDefSchema = z.object({
  id: z.string().optional(),
  name: i18nText,
  objectSet: objectSetDef,
  aggregate: z.object({
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
    prop: z.string().optional(),
  }),
  unit: z.string().max(20).optional(),
  target: z.number().optional(),
  higherIsBetter: z.boolean().optional(),
});

export const automationDefSchema = z.object({
  id: z.string().optional(),
  name: i18nText,
  trigger: z.discriminatedUnion('kind', [
    z.object({kind: z.literal('threshold'), objectType: z.string().min(1)}),
    z.object({
      kind: z.literal('objectSetCount'),
      objectSet: objectSetDef,
      op: z.enum(['gt', 'lt']),
      value: z.number(),
    }),
    z.object({kind: z.literal('schedule'), objectSet: objectSetDef}),
  ]),
  condition: filterExpr.optional(),
  effects: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({kind: z.literal('alert')}),
        z.object({
          kind: z.literal('recommend'),
          perturbation: z
            .object({property: z.string(), change: z.number().min(-1).max(1)})
            .optional(),
        }),
        z.object({
          kind: z.literal('action'),
          actionType: z.string(),
          params: z.record(z.string(), z.unknown()).optional(),
        }),
      ]),
    )
    .min(1),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  cooldownSec: z.number().int().min(0).max(86_400).optional(),
  enabled: z.boolean().optional(),
});

export const updateAlertInputSchema = z.object({
  status: z.enum(['ACKED', 'CLOSED']),
});

export const cockpitLayoutSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  columns: z.literal(12),
  widgets: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum([
          'kpi',
          'trend',
          'alerts',
          'recommendations',
          'objectTable',
          'dataHealth',
          'impacted',
        ]),
        x: z.number().int().min(0).max(11),
        y: z.number().int().min(0),
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1).max(12),
        binding: z
          .object({
            kpiId: z.string().optional(),
            objectSetId: z.string().optional(),
          })
          .optional(),
      }),
    )
    .max(40),
});

export const replayDlqInputSchema = z
  .object({ids: z.array(z.string()).optional()})
  .default({});
