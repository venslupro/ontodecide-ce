/**
 * Tenant repository: read + update the user rows needed by the Cleanup
 * Service. The repository deliberately exposes a tiny surface so the
 * Cleanup Worker cannot accidentally mutate auth state.
 */
import type { TenantRow, TenantDueRow } from '../types/env.js';
import { nowIso } from '@ontodecide/shared';
import { and, or, eq, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users } from '@ontodecide/shared/db';

/**
 * Expiry condition: account has expired (expires_at <= now) AND still
 * eligible for cleanup (active, not already cleared, not admin).
 */
const baseEligibility = and(
  eq(users.is_active, 1),
  eq(users.is_data_cleared, 0),
  ne(users.role, 'admin'),
);

/**
 * Build the inactivity-condition SQL fragment for the given days value.
 * A user counts as inactive when:
 *   - has a last_login_at and it is older than (now - inactiveDays); OR
 *   - has never logged in (last_login_at IS NULL) and created_at is older
 *     than (now - inactiveDays).
 */
function inactivityCondition(inactiveDays: number) {
  const days = Math.max(0, Math.floor(inactiveDays));
  return or(
    sql`(
      ${users.last_login_at} IS NOT NULL
      AND datetime(${users.last_login_at}) <= datetime('now', ${`-${days} days'`})
    )`,
    sql`(
      ${users.last_login_at} IS NULL
      AND datetime(${users.created_at}) <= datetime('now', ${`-${days} days'`})
    )`,
  );
}

/**
 * Classify why a tenant is due for cleanup:
 *   expired  → hit expiry condition (expires_at lapsed)
 *   inactive → hit inactivity threshold only
 *   both     → hit both conditions simultaneously
 *
 * Expiry wins when both are true; the trigger still hard-deletes in that
 * case because the account is no longer entitled to exist regardless of
 * recent activity.
 */
function classifyDueReason(expired: boolean | null, inactive: boolean | null): TenantDueRow['due_reason'] {
  if (expired && inactive) return 'both';
  if (expired) return 'expired';
  if (inactive) return 'inactive';
  return 'expired'; // fallback; callers only iterate rows that match the OR
}

export interface ITenantCleanupRepository {
  /** List tenants due for cleanup (active + retention exceeded OR inactive N days). */
  listDueForCleanup(inactiveDays?: number): Promise<TenantDueRow[]>;
  /** Find a single tenant by id. */
  findById(id: string): Promise<TenantRow | null>;
  /** Find a single tenant by tenant_id. */
  findByTenantId(tenantId: string): Promise<TenantRow | null>;
  /** Mark a tenant's data as cleared. */
  markCleared(tenantId: string, dataSizeEstimate: number): Promise<void>;
}

export class D1TenantCleanupRepository implements ITenantCleanupRepository {
  private readonly orm: ReturnType<typeof drizzle>;

  constructor(db: D1Database) {
    this.orm = drizzle(db);
  }

  public async listDueForCleanup(inactiveDays?: number): Promise<TenantDueRow[]> {
    // Expiry leg: standard retention-exceeded condition.
    const expiryLeg = sql`${users.expires_at} IS NOT NULL AND datetime(${users.expires_at}) <= datetime('now')`;

    // When inactiveDays is supplied, combine the two legs with OR.
    // Otherwise (for backwards compatibility) only the expiry leg runs.
    const whereClause =
      typeof inactiveDays === 'number'
        ? and(baseEligibility, or(expiryLeg, inactivityCondition(inactiveDays)))
        : and(baseEligibility, expiryLeg);

    const rows = await this.orm
      .select({
        id: users.id,
        tenant_id: users.tenant_id,
        role: users.role,
        is_active: users.is_active,
        is_data_cleared: users.is_data_cleared,
        last_cleanup_at: users.last_cleanup_at,
        data_retention_days: users.data_retention_days,
        data_size_estimate: users.data_size_estimate,
        expires_at: users.expires_at,
        due_expired: sql<0 | 1>`CASE WHEN (${expiryLeg}) THEN 1 ELSE 0 END`.as('due_expired'),
        due_inactive:
          typeof inactiveDays === 'number'
            ? sql<0 | 1>`CASE WHEN (${inactivityCondition(inactiveDays)}) THEN 1 ELSE 0 END`.as(
                'due_inactive',
              )
            : sql<0 | 1>`0`.as('due_inactive'),
      })
      .from(users)
      .where(whereClause)
      .all();

    return (rows as unknown as Array<TenantRow & { due_expired: 0 | 1; due_inactive: 0 | 1 }>).map(
      (row) => {
        const { due_expired, due_inactive, ...tenant } = row;
        return {
          ...tenant,
          due_reason: classifyDueReason(due_expired === 1, due_inactive === 1),
        };
      },
    );
  }

  public async findById(id: string): Promise<TenantRow | null> {
    const row = await this.orm
      .select({
        id: users.id,
        tenant_id: users.tenant_id,
        role: users.role,
        is_active: users.is_active,
        is_data_cleared: users.is_data_cleared,
        last_cleanup_at: users.last_cleanup_at,
        data_retention_days: users.data_retention_days,
        data_size_estimate: users.data_size_estimate,
        expires_at: users.expires_at,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .get();
    return (row as TenantRow | undefined) ?? null;
  }

  public async findByTenantId(tenantId: string): Promise<TenantRow | null> {
    const row = await this.orm
      .select({
        id: users.id,
        tenant_id: users.tenant_id,
        role: users.role,
        is_active: users.is_active,
        is_data_cleared: users.is_data_cleared,
        last_cleanup_at: users.last_cleanup_at,
        data_retention_days: users.data_retention_days,
        data_size_estimate: users.data_size_estimate,
        expires_at: users.expires_at,
      })
      .from(users)
      .where(eq(users.tenant_id, tenantId))
      .limit(1)
      .get();
    return (row as TenantRow | undefined) ?? null;
  }

  public async markCleared(tenantId: string, dataSizeEstimate: number): Promise<void> {
    await this.orm
      .update(users)
      .set({
        is_data_cleared: 1,
        last_cleanup_at: nowIso(),
        data_size_estimate: dataSizeEstimate,
      })
      .where(eq(users.tenant_id, tenantId))
      .run();
  }
}
