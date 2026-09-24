/**
 * @fileoverview Object Set evaluation helpers: splitting a filter into the
 * part answerable from og_prop_index and an in-memory residual, in-memory
 * sorting and aggregate math.
 */

import {filterProps, matchFilter} from '@ontodecide/shared-kernel';
import type {FilterExpr, OrderBy} from '@ontodecide/shared-kernel';

/** Maximum candidates for in-memory filtering / sorting. */
export const IN_MEMORY_MAX = 200;

/** Maximum Search Around hops served from D1. */
export const SEARCH_AROUND_MAX_HOPS = 2;

/** A filter split into an indexed (pushed-down) part and a residual. */
export interface FilterSplit {
  indexed?: FilterExpr;
  residual?: FilterExpr;
}

function and(args: FilterExpr[]): FilterExpr | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1) return args[0];
  return {op: 'and', args};
}

function flattenAnd(expr: FilterExpr): FilterExpr[] {
  return expr.op === 'and' ? expr.args.flatMap(flattenAnd) : [expr];
}

/**
 * Splits a filter: conjuncts that only reference indexed properties are
 * pushed down; everything else becomes the residual.
 */
export function splitFilter(
  expr: FilterExpr | undefined,
  indexed: ReadonlySet<string>,
): FilterSplit {
  if (!expr) return {};
  const onlyIndexed = (e: FilterExpr): boolean =>
    filterProps(e).every(p => indexed.has(p));
  if (onlyIndexed(expr)) return {indexed: expr};
  if (expr.op !== 'and') return {residual: expr};
  const parts = flattenAnd(expr);
  return {
    indexed: and(parts.filter(onlyIndexed)),
    residual: and(parts.filter(p => !onlyIndexed(p))),
  };
}

/** Anything with a RID and properties. */
export interface Sortable {
  rid: string;
  props: Record<string, unknown>;
}

function cmp(a: unknown, b: unknown): number {
  const na = a === null || a === undefined;
  const nb = b === null || b === undefined;
  if (na || nb) return na === nb ? 0 : na ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = typeof a === 'string' ? a : JSON.stringify(a);
  const sb = typeof b === 'string' ? b : JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Stable in-memory sort; nulls last, ties broken by RID. */
export function sortObjects<T extends Sortable>(
  items: readonly T[],
  orderBy: readonly OrderBy[] = [],
): T[] {
  return [...items].sort((x, y) => {
    for (const o of orderBy) {
      const a = x.props[o.prop];
      const b = y.props[o.prop];
      const nullish = (v: unknown) => v === null || v === undefined;
      let c = cmp(a, b);
      if (c !== 0 && o.dir === 'desc' && !nullish(a) && !nullish(b)) c = -c;
      if (c !== 0) return c;
    }
    return x.rid < y.rid ? -1 : x.rid > y.rid ? 1 : 0;
  });
}

/** Filters items in memory. */
export function filterObjects<T extends Sortable>(
  items: readonly T[],
  expr: FilterExpr | undefined,
): T[] {
  return expr ? items.filter(i => matchFilter(expr, i.props)) : [...items];
}

/** Aggregate function. */
export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

/**
 * Aggregates values. `count` counts every item; the others use finite
 * numbers only and return 0 for an empty input.
 */
export function aggregateValues(
  fn: AggregateFn,
  values: readonly unknown[],
): number {
  if (fn === 'count') return values.length;
  const nums = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (nums.length === 0) return 0;
  switch (fn) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    default:
      return Math.max(...nums);
  }
}
