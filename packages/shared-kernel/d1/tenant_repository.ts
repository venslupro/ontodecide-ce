/**
 * @fileoverview Repository bases enforcing workspace isolation (详细设计 6.2).
 *
 * Every business repository extends {@link TenantRepository} and reaches
 * D1 only through `stmt()`, which binds `?1` to the workspace id from the
 * CallCtx and rejects SQL without a `tenant_id = ?1` predicate (or an
 * INSERT whose first column is tenant_id). `scripts/check_sql.mjs` rejects
 * direct `db.prepare()` calls elsewhere.
 *
 * {@link SystemRepository} is the only exception: outbox redelivery and
 * TenantLifecycle implementations, constructed only in scheduled(), queue()
 * or lifecycle entry points.
 */

import {AppError} from '../errors';

const TENANT_PREDICATE = /\btenant_id\s*=\s*\?1\b/i;
const TENANT_INSERT =
  /^\s*(INSERT|REPLACE)\s+(OR\s+\w+\s+)?INTO\s+\w+\s*\(\s*tenant_id\b/i;

/** Whether SQL is scoped to the workspace bound as ?1. */
export function isTenantScoped(sql: string): boolean {
  return TENANT_PREDICATE.test(sql) || TENANT_INSERT.test(sql);
}

/** Base class of every workspace-scoped repository. */
export abstract class TenantRepository {
  constructor(
    protected readonly db: D1Database,
    protected readonly tid: string,
  ) {
    if (!tid) throw new AppError('INTERNAL', 'TENANT_ID_MISSING');
  }

  /** Prepares a statement with ?1 bound to the workspace id. */
  protected stmt(sql: string, ...args: unknown[]): D1PreparedStatement {
    if (!isTenantScoped(sql)) {
      throw new AppError('INTERNAL', 'TENANT_FILTER_MISSING');
    }
    return this.db.prepare(sql).bind(this.tid, ...args);
  }
}

/**
 * Base class for cross-workspace maintenance (outbox redelivery, lifecycle).
 * The tenant id, when needed, is an explicit argument.
 */
export abstract class SystemRepository {
  constructor(protected readonly db: D1Database) {}

  /** Prepares an unscoped statement. */
  protected sql(sql: string, ...args: unknown[]): D1PreparedStatement {
    return this.db.prepare(sql).bind(...args);
  }
}
