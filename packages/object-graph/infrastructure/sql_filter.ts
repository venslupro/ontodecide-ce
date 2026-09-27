/**
 * @fileoverview Translates a {@link FilterExpr} over indexed properties into
 * SQL on og_prop_index (one value column, one secondary index). Parameters
 * are numbered from ?2 because ?1 is the workspace id bound by
 * TenantRepository.
 */

import type {FilterExpr, FilterValue} from '@ontodecide/shared-kernel';

/** Collects positional parameters as `?n` placeholders. */
export class SqlArgs {
  private readonly list: unknown[] = [];
  constructor(private readonly first = 2) {}

  /** Adds a value and returns its placeholder. */
  add(value: unknown): string {
    this.list.push(value);
    return `?${this.first + this.list.length - 1}`;
  }

  /** Values in placeholder order. */
  values(): unknown[] {
    return [...this.list];
  }
}

function sqlValue(v: FilterValue): string | number {
  return typeof v === 'boolean' ? (v ? 1 : 0) : v;
}

/** Escapes LIKE wildcards (escape character `\`). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

function indexExists(
  alias: string,
  args: SqlArgs,
  prop: string,
  cond: () => string,
): string {
  const propArg = args.add(prop);
  return (
    'EXISTS (SELECT 1 FROM og_prop_index p WHERE p.tenant_id = ?1 AND ' +
    `p.rid = ${alias}.rid AND p.prop = ${propArg}${cond()})`
  );
}

const OPS = {eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<='} as const;

/**
 * SQL predicate for a filter; `alias` is the og_object alias. Every leaf
 * becomes a correlated EXISTS on og_prop_index.
 */
export function filterToSql(
  expr: FilterExpr,
  alias: string,
  args: SqlArgs,
): string {
  switch (expr.op) {
    case 'and':
    case 'or': {
      if (!expr.args.length) return expr.op === 'and' ? '1' : '0';
      const parts = expr.args.map(a => filterToSql(a, alias, args));
      return `(${parts.join(expr.op === 'and' ? ' AND ' : ' OR ')})`;
    }
    case 'not':
      return `NOT ${filterToSql(expr.arg, alias, args)}`;
    case 'exists':
      return indexExists(
        alias,
        args,
        expr.prop,
        () => ' AND p.value IS NOT NULL',
      );
    case 'in':
      return indexExists(
        alias,
        args,
        expr.prop,
        () =>
          ` AND p.value IN (SELECT value FROM json_each(${args.add(
            JSON.stringify(expr.values.map(sqlValue)),
          )}))`,
      );
    case 'contains':
      return indexExists(
        alias,
        args,
        expr.prop,
        () =>
          ` AND typeof(p.value) = 'text' AND p.value LIKE ${args.add(
            likePattern(expr.value),
          )} ESCAPE '\\'`,
      );
    case 'neq':
      return `NOT ${indexExists(
        alias,
        args,
        expr.prop,
        () => ` AND p.value = ${args.add(sqlValue(expr.value))}`,
      )}`;
    default: {
      const op = OPS[expr.op];
      return indexExists(
        alias,
        args,
        expr.prop,
        () => ` AND p.value ${op} ${args.add(sqlValue(expr.value))}`,
      );
    }
  }
}
