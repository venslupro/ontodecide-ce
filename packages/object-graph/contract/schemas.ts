/**
 * @fileoverview Zod schemas for object graph REST inputs.
 */

import {z} from 'zod';

const filterExpr: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({op: z.enum(['and', 'or']), args: z.array(filterExpr)}),
    z.object({op: z.literal('not'), arg: filterExpr}),
    z.object({
      op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
      prop: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({
      op: z.literal('in'),
      prop: z.string(),
      values: z.array(z.union([z.string(), z.number(), z.boolean()])),
    }),
    z.object({op: z.literal('contains'), prop: z.string(), value: z.string()}),
    z.object({op: z.literal('exists'), prop: z.string()}),
  ]),
);

export const filterExprSchema = filterExpr;

export const objectSetDefSchema = z.object({
  objectType: z.string().min(1),
  filter: filterExpr.optional(),
  searchAround: z
    .array(z.object({link: z.string(), direction: z.enum(['out', 'in'])}))
    .max(3)
    .optional(),
  orderBy: z
    .array(z.object({prop: z.string(), dir: z.enum(['asc', 'desc'])}))
    .optional(),
});

export const pageInputSchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .default({});

export const saveObjectSetInputSchema = z.object({
  name: z.string().min(1).max(100),
  definition: objectSetDefSchema,
});

export const applyActionInputSchema = z.object({
  target: z.string().startsWith('ri.'),
  params: z.record(z.string(), z.unknown()).default({}),
  recommendationId: z.string().optional(),
});

export const resolveMergeInputSchema = z.object({accept: z.boolean()});
