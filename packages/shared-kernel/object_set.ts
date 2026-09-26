/**
 * @fileoverview Object Set definitions, filter expressions and pagination.
 * Filters are also used as automation conditions.
 */

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

/** One hop of a Search Around. */
export interface SearchAroundStep {
  link: string;
  direction: 'out' | 'in';
}

/** Order clause. */
export interface OrderBy {
  prop: string;
  dir: 'asc' | 'desc';
}

/** A saved or ad-hoc Object Set. */
export interface ObjectSetDef {
  objectType: string;
  filter?: FilterExpr;
  /** ≤ 2 hops are served from D1; deeper traversals use the graph projection. */
  searchAround?: SearchAroundStep[];
  orderBy?: OrderBy[];
}

/** Page request (opaque cursor). */
export interface PageRequest {
  cursor?: string;
  limit?: number;
}

/** Page of results. */
export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  degraded?: boolean;
}

/** Pagination bounds (see detailed design, boundary values). */
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

/** Clamps a requested page size into [1, 200]. */
export function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return PAGE_LIMIT_DEFAULT;
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.floor(limit)));
}

/** Encodes an offset-style cursor. */
export function encodeCursor(value: Record<string, unknown>): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '');
}

/** Decodes a cursor produced by {@link encodeCursor}; null if invalid. */
export function decodeCursor<T = Record<string, unknown>>(
  cursor?: string | null,
): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(atob(cursor)) as T;
  } catch {
    return null;
  }
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
