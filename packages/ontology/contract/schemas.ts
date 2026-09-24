/**
 * @fileoverview Zod schemas for ontology REST inputs (shared by api-gateway
 * validation and the web app forms).
 */

import {z} from 'zod';

const apiName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Invalid api name');
const i18nText = z.union([z.string(), z.record(z.string(), z.string())]);
const jsonLogic: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonLogic),
    z.record(z.string(), jsonLogic),
  ]),
);
const dataType = z
  .string()
  .regex(
    /^(string|integer|double|boolean|date|timestamp|geopoint|enum|objectRef:[A-Za-z][A-Za-z0-9_]*)$/,
    'Invalid data type',
  );

export const propertyDefSchema = z.object({
  apiName,
  displayName: i18nText,
  dataType,
  required: z.boolean().optional(),
  unit: z.string().optional(),
  indexed: z.boolean().optional(),
  markings: z.array(z.string()).optional(),
  semanticTags: z.array(z.string()).optional(),
  sensitive: z.boolean().optional(),
  enumValues: z.array(z.string()).optional(),
  description: i18nText.optional(),
});

export const objectTypeDefSchema = z.object({
  apiName,
  displayName: i18nText,
  icon: z.string().optional(),
  primaryKey: z.string(),
  titleProperty: z.string(),
  properties: z.array(propertyDefSchema).min(1),
  graphProjected: z.boolean().optional(),
  description: i18nText.optional(),
});

export const linkTypeDefSchema = z.object({
  apiName,
  displayName: i18nText,
  from: z.string(),
  to: z.string(),
  cardinality: z.enum(['one', 'many']),
  propagation: z.object({defaultWeight: z.number().min(0).max(1)}).optional(),
});

const filterSchema: z.ZodType<unknown> = z.lazy(() =>
  z.record(z.string(), z.unknown()),
);

export const actionTypeDefSchema = z.object({
  apiName,
  displayName: i18nText,
  targetType: z.string(),
  parameters: z.array(
    z.object({
      apiName,
      displayName: i18nText,
      dataType,
      required: z.boolean().optional(),
      defaultValue: z.unknown().optional(),
      suggest: z
        .object({
          objectType: z.string(),
          filter: filterSchema.optional(),
          orderBy: z.object({prop: z.string(), dir: z.enum(['asc', 'desc'])}),
          sharesLinkWithTarget: z
            .object({link: z.string(), direction: z.enum(['in', 'out'])})
            .optional(),
        })
        .optional(),
    }),
  ),
  preconditions: z.array(z.object({expr: jsonLogic, message: i18nText})),
  effects: z.array(
    z.discriminatedUnion('kind', [
      z.object({kind: z.literal('set'), prop: z.string(), value: jsonLogic}),
      z.object({kind: z.literal('increment'), prop: z.string(), by: jsonLogic}),
      z.object({
        kind: z.literal('relink'),
        link: z.string(),
        direction: z.enum(['in', 'out']),
        toParam: z.string(),
      }),
      z.object({
        kind: z.literal('unlink'),
        link: z.string(),
        direction: z.enum(['in', 'out']),
        toParam: z.string().optional(),
      }),
    ]),
  ),
  requiresApproval: z.boolean(),
  impact: z
    .array(z.object({property: z.string(), change: z.number().min(-1).max(1)}))
    .optional(),
  writeback: z
    .discriminatedUnion('kind', [
      z.object({kind: z.literal('none')}),
      z.object({kind: z.literal('webhook'), url: z.string().url()}),
    ])
    .optional(),
  description: i18nText.optional(),
});

export const schemaDefSchema = z.object({
  apiName,
  displayName: i18nText,
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  description: i18nText.optional(),
  objectTypes: z.array(objectTypeDefSchema),
  linkTypes: z.array(linkTypeDefSchema),
  actionTypes: z.array(actionTypeDefSchema),
  functions: z.array(
    z.object({
      apiName,
      displayName: i18nText.optional(),
      objectType: z.string().optional(),
      expr: jsonLogic,
      returns: dataType,
    }),
  ),
  simulationKpis: z
    .array(
      z.object({
        apiName,
        displayName: i18nText,
        objectType: z.string(),
        property: z.string().optional(),
        agg: z.enum(['sum', 'avg', 'count']),
        unit: z.string().optional(),
        higherIsBetter: z.boolean(),
      }),
    )
    .optional(),
});

export const publishInputSchema = z
  .object({confirmVersion: z.string().optional()})
  .default({});

export const importPackInputSchema = z
  .object({
    packId: z.string().optional(),
    pack: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(v => v.packId || v.pack, 'packId or pack is required');
