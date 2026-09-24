/**
 * @fileoverview Translates filter expressions and orderings over indexed
 * properties into SQL against og_prop_index (correlated to `o.rid`).
 * List-valued parameters are bound as one JSON array (json_each) to stay
 * well below D1's bound-parameter limit.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {FilterExpr, FilterValue, OrderBy} from '@ontodecide/shared-kernel';

/** A SQL fragment with its bound parameters. */
export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/** D1 allows 100 bound parameters per statement; keep a margin. */
export const MAX_BOUND_PARAMS = 90;

/** Escapes LIKE wildcards (escape character `\`). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`);
}

function leaf(prop: string, cond: string, params: unknown[]): SqlFragment {
  return {
    sql: `EXISTS (SELECT 1 FROM og_prop_index i WHERE i.rid = o.rid AND i.prop = ? AND ${cond})`,
    params: [prop, ...params],
  };
}

function column(value: FilterValue): {col: string; value: unknown} {
  if (typeof value === 'number') return {col: 'i.num_val', value};
  if (typeof value === 'boolean')
    return {col: 'i.num_val', value: value ? 1 : 0};
  return {col: 'i.str_val', value};
}

const CMP = {eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<='} as const;

/** Translates a filter over indexed properties to a WHERE fragment. */
export function filterToSql(expr: FilterExpr): SqlFragment {
  switch (expr.op) {
    case 'and':
    case 'or': {
      if (!expr.args.length) {
        return {sql: expr.op === 'and' ? '1 = 1' : '1 = 0', params: []};
      }
      const parts = expr.args.map(filterToSql);
      return {
        sql: `(${parts.map(p => p.sql).join(expr.op === 'and' ? ' AND ' : ' OR ')})`,
        params: parts.flatMap(p => p.params),
      };
    }
    case 'not': {
      const inner = filterToSql(expr.arg);
      return {sql: `NOT (${inner.sql})`, params: inner.params};
    }
    case 'exists':
      return leaf(
        expr.prop,
        '(i.num_val IS NOT NULL OR i.str_val IS NOT NULL)',
        [],
      );
    case 'contains':
      return leaf(expr.prop, "i.str_val LIKE ? ESCAPE '\\'", [
        `%${likeEscape(expr.value)}%`,
      ]);
    case 'in': {
      const nums = expr.values
        .filter(v => typeof v !== 'string')
        .map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
      const strs = expr.values.filter(v => typeof v === 'string');
      return leaf(
        expr.prop,
        '(i.num_val IN (SELECT value FROM json_each(?)) OR i.str_val IN (SELECT value FROM json_each(?)))',
        [JSON.stringify(nums), JSON.stringify(strs)],
      );
    }
    case 'neq': {
      const c = column(expr.value);
      const inner = leaf(expr.prop, `${c.col} = ?`, [c.value]);
      return {sql: `NOT ${inner.sql}`, params: inner.params};
    }
    default: {
      const c = column(expr.value);
      return leaf(expr.prop, `${c.col} ${CMP[expr.op]} ?`, [c.value]);
    }
  }
}

/** Joins and ORDER BY terms for an ordering (indexed props or built-ins). */
export function orderToSql(orderBy: readonly OrderBy[] | undefined): {
  joins: SqlFragment;
  orderBy: string;
} {
  const joins: string[] = [];
  const params: unknown[] = [];
  const terms: string[] = [];
  (orderBy ?? []).forEach((o, n) => {
    const dir = o.dir === 'desc' ? 'DESC' : 'ASC';
    if (o.prop === 'updatedAt') {
      terms.push(`o.updated_at ${dir}`);
      return;
    }
    if (o.prop === 'title') {
      terms.push(`(o.title IS NULL) ASC, o.title ${dir}`);
      return;
    }
    const a = `s${n}`;
    joins.push(
      `LEFT JOIN og_prop_index ${a} ON ${a}.rid = o.rid AND ${a}.prop = ?`,
    );
    params.push(o.prop);
    terms.push(
      `(${a}.num_val IS NULL AND ${a}.str_val IS NULL) ASC, ${a}.num_val ${dir}, ${a}.str_val ${dir}`,
    );
  });
  terms.push('o.rid ASC');
  return {joins: {sql: joins.join(' '), params}, orderBy: terms.join(', ')};
}

/** Throws OBJECT_SET_INVALID when a statement would bind too many params. */
export function checkParams(params: readonly unknown[]): void {
  if (params.length > MAX_BOUND_PARAMS) {
    throw new AppError('OBJECT_SET_INVALID', 'Filter is too complex');
  }
}
