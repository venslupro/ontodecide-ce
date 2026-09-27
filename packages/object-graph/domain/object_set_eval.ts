/**
 * @fileoverview Object query planning (详细设计 6.11.3): only filters and
 * sort keys on indexed properties are pushed down to D1; the rest is
 * evaluated in memory, which is bounded because a workspace holds at most
 * 300 objects.
 */

import {AppError, filterProps} from '@ontodecide/shared-kernel';
import type {FilterExpr, OrderBy} from '@ontodecide/shared-kernel';

/** A filter split into a D1 part and an in-memory residual. */
export interface FilterSplit {
  pushdown?: FilterExpr;
  residual?: FilterExpr;
}

function allIndexed(expr: FilterExpr, indexed: ReadonlySet<string>): boolean {
  return filterProps(expr).every(p => indexed.has(p));
}

/**
 * Splits a filter. A filter whose properties are all indexed is pushed down
 * whole; for a top-level `and` the indexed conjuncts are pushed down and
 * the others stay residual; anything else is residual.
 */
export function splitFilter(
  expr: FilterExpr | undefined,
  indexed: ReadonlySet<string>,
): FilterSplit {
  if (!expr) return {};
  if (allIndexed(expr, indexed)) return {pushdown: expr};
  if (expr.op !== 'and') return {residual: expr};
  const down = expr.args.filter(a => allIndexed(a, indexed));
  const rest = expr.args.filter(a => !allIndexed(a, indexed));
  const wrap = (args: FilterExpr[]): FilterExpr | undefined =>
    args.length === 0
      ? undefined
      : args.length === 1
        ? args[0]
        : {op: 'and', args};
  return {pushdown: wrap(down), residual: wrap(rest)};
}

/** Built-in sort keys (columns of og_object). */
export const BUILTIN_SORT_KEYS = ['title', 'primaryKey', 'updatedAt'] as const;

/** How a query is ordered. */
export type SortPlan =
  | {kind: 'default'}
  | {
      kind: 'column';
      key: (typeof BUILTIN_SORT_KEYS)[number];
      dir: 'asc' | 'desc';
    }
  | {kind: 'indexed'; prop: string; dir: 'asc' | 'desc'};

/**
 * Plans the order. Sorting is allowed only on built-in keys or on indexed
 * properties of the queried type (VALIDATION_FAILED otherwise).
 */
export function planSort(
  orderBy: OrderBy | undefined,
  indexed: ReadonlySet<string>,
): SortPlan {
  if (!orderBy) return {kind: 'default'};
  const dir = orderBy.dir === 'desc' ? 'desc' : 'asc';
  if ((BUILTIN_SORT_KEYS as readonly string[]).includes(orderBy.prop)) {
    return {
      kind: 'column',
      key: orderBy.prop as (typeof BUILTIN_SORT_KEYS)[number],
      dir,
    };
  }
  if (indexed.has(orderBy.prop)) {
    return {kind: 'indexed', prop: orderBy.prop, dir};
  }
  throw new AppError(
    'VALIDATION_FAILED',
    `orderBy ${orderBy.prop} is not an indexed property`,
  );
}

/** Whether free text matches an object's title, primary key or RID. */
export function matchesText(
  q: string,
  o: {rid: string; title: string; primaryKey: string},
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    o.rid.toLowerCase() === needle ||
    o.title.toLowerCase().includes(needle) ||
    o.primaryKey.toLowerCase().includes(needle)
  );
}
