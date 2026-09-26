/**
 * @fileoverview Editable filter model (nested AND/OR groups of
 * property/operator/value rows) and conversion to/from FilterExpr. Used by
 * the object filter builder and the automation condition builder.
 */

import type {FilterExpr, FilterValue} from '@ontodecide/shared-kernel';
import {
  type FilterOp,
  getRenderer,
  type RenderProp,
} from '../renderers/registry';

/** One condition row. */
export interface FilterCondition {
  kind: 'cond';
  id: string;
  prop: string;
  op: FilterOp;
  /** Raw user input; `in` uses comma-separated values. */
  value: string;
}

/** A group of conditions combined with AND / OR. */
export interface FilterGroup {
  kind: 'group';
  id: string;
  combinator: 'and' | 'or';
  items: (FilterCondition | FilterGroup)[];
}

let seq = 0;
const nid = (p: string) => `${p}${++seq}`;

/** New empty condition. */
export function newCondition(
  prop = '',
  op: FilterOp = 'eq',
  value = '',
): FilterCondition {
  return {kind: 'cond', id: nid('c'), prop, op, value};
}

/** New group. */
export function newGroup(
  combinator: 'and' | 'or' = 'and',
  items: (FilterCondition | FilterGroup)[] = [],
): FilterGroup {
  return {kind: 'group', id: nid('g'), combinator, items};
}

/** Whether an operator takes no value. */
export function opIsUnary(op: FilterOp): boolean {
  return op === 'exists';
}

function condToExpr(
  c: FilterCondition,
  props: Record<string, RenderProp>,
): FilterExpr | null {
  const p = props[c.prop];
  if (!c.prop || !p) return null;
  if (c.op === 'exists') return {op: 'exists', prop: c.prop};
  const r = getRenderer(p.dataType);
  if (c.op === 'in') {
    const values = c.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => r.parse(s, p))
      .filter((v): v is FilterValue => v !== null);
    return values.length ? {op: 'in', prop: c.prop, values} : null;
  }
  if (c.op === 'contains')
    return c.value ? {op: 'contains', prop: c.prop, value: c.value} : null;
  const v = r.parse(c.value, p);
  if (v === null) return null;
  return {op: c.op, prop: c.prop, value: v};
}

/**
 * Converts a group to a FilterExpr. Incomplete rows are skipped; a group
 * with a single member collapses to that member; empty → undefined.
 */
export function toFilterExpr(
  g: FilterGroup,
  props: Record<string, RenderProp>,
): FilterExpr | undefined {
  const args = g.items
    .map(i =>
      i.kind === 'cond'
        ? condToExpr(i, props)
        : (toFilterExpr(i, props) ?? null),
    )
    .filter((e): e is FilterExpr => e !== null);
  if (args.length === 0) return undefined;
  if (args.length === 1) return args[0];
  return {op: g.combinator, args};
}

/** Converts a FilterExpr back into an editable group. */
export function fromFilterExpr(
  expr: FilterExpr | undefined | null,
): FilterGroup {
  if (!expr) return newGroup('and', []);
  if (expr.op === 'and' || expr.op === 'or') {
    return newGroup(
      expr.op,
      expr.args
        .map(a =>
          a.op === 'and' || a.op === 'or' ? fromFilterExpr(a) : exprToCond(a),
        )
        .filter(Boolean) as (FilterCondition | FilterGroup)[],
    );
  }
  const c = exprToCond(expr);
  return newGroup('and', c ? [c] : []);
}

function exprToCond(e: FilterExpr): FilterCondition | null {
  switch (e.op) {
    case 'exists':
      return newCondition(e.prop, 'exists', '');
    case 'in':
      return newCondition(e.prop, 'in', e.values.join(', '));
    case 'contains':
      return newCondition(e.prop, 'contains', e.value);
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return newCondition(e.prop, e.op, String(e.value));
    default:
      return null;
  }
}

/** Counts complete conditions in a group (for badges). */
export function countConditions(g: FilterGroup): number {
  return g.items.reduce(
    (n, i) => n + (i.kind === 'cond' ? (i.prop ? 1 : 0) : countConditions(i)),
    0,
  );
}
