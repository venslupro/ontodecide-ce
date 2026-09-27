/**
 * @fileoverview Declarative filters over object properties. Used by object
 * queries (only indexed properties are pushed down to D1) and by automation
 * conditions.
 */

import {z} from 'zod';

/** Primitive value allowed in filters. */
export type FilterValue = string | number | boolean;

/** A declarative, serializable filter over object properties. */
export type FilterExpr =
  | {op: 'and' | 'or'; args: FilterExpr[]}
  | {op: 'not'; arg: FilterExpr}
  | {
      op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      prop: string;
      value: FilterValue;
    }
  | {op: 'in'; prop: string; values: FilterValue[]}
  | {op: 'contains'; prop: string; value: string}
  | {op: 'exists'; prop: string};

/** Order clause. */
export interface OrderBy {
  prop: string;
  dir: 'asc' | 'desc';
}

/** Collects every property referenced by a filter. */
export function filterProps(expr: FilterExpr | undefined): string[] {
  if (!expr) return [];
  switch (expr.op) {
    case 'and':
    case 'or':
      return [...new Set(expr.args.flatMap(filterProps))];
    case 'not':
      return filterProps(expr.arg);
    default:
      return [expr.prop];
  }
}

function compare(a: unknown, b: FilterValue): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === undefined || a === null) return null;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Evaluates a filter against a property bag. */
export function matchFilter(
  expr: FilterExpr | undefined,
  props: Record<string, unknown>,
): boolean {
  if (!expr) return true;
  switch (expr.op) {
    case 'and':
      return expr.args.every(e => matchFilter(e, props));
    case 'or':
      return expr.args.some(e => matchFilter(e, props));
    case 'not':
      return !matchFilter(expr.arg, props);
    case 'exists':
      return props[expr.prop] !== undefined && props[expr.prop] !== null;
    case 'in':
      return expr.values.some(v => props[expr.prop] === v);
    case 'contains': {
      const v = props[expr.prop];
      return (
        typeof v === 'string' &&
        v.toLowerCase().includes(expr.value.toLowerCase())
      );
    }
    case 'eq':
      return props[expr.prop] === expr.value;
    case 'neq':
      return props[expr.prop] !== expr.value;
    default: {
      const c = compare(props[expr.prop], expr.value);
      if (c === null) return false;
      if (expr.op === 'gt') return c > 0;
      if (expr.op === 'gte') return c >= 0;
      if (expr.op === 'lt') return c < 0;
      return c <= 0;
    }
  }
}

const filterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** Zod schema of {@link FilterExpr} (recursive, depth-limited by size). */
export const filterExprSchema: z.ZodType<FilterExpr> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(['and', 'or']),
      args: z.array(filterExprSchema).max(20),
    }),
    z.object({op: z.literal('not'), arg: filterExprSchema}),
    z.object({
      op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
      prop: z.string(),
      value: filterValueSchema,
    }),
    z.object({
      op: z.literal('in'),
      prop: z.string(),
      values: z.array(filterValueSchema).max(100),
    }),
    z.object({op: z.literal('contains'), prop: z.string(), value: z.string()}),
    z.object({op: z.literal('exists'), prop: z.string()}),
  ]),
);
