/**
 * Tenant repository: read + update the user rows needed by the Cleanup
 * Service. The repository deliberately exposes a tiny surface so the
 * Cleanup Worker cannot accidentally mutate auth state.
 */
import type {TenantRow} from '../types/env.js';
import {nowIso} from '@ontodecide/shared';
import {and, eq, ne, sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/d1';
import {users} from '@ontodecide/shared/db';

/**
 * SQL condition: a tenant is due for cleanup when the account has expired
 * (expires_at <= now) and the account hasn't been cleaned up yet.
 */
// eslint-disable-next-line max-len
const expiryDueCondition = sql`${users.expires_at} IS NOT NULL AND datetime(${users.expires_at}) <= datetime('now')`;

export interface ITenantCleanupRepository {
  /** List tenants due for cleanup (active + retention exceeded). */
  listDueForCleanup(): Promise<TenantRow[]>;
  /** Find a single tenant by id. */
  findById(id: string): Promise<TenantRow | null>;
  /** Mark a tenant's data as cleared. */
  markCleared(tenantId: string, dataSizeEstimate: number): Promise<void>;
}

export class D1TenantCleanupRepository implements ITenantCleanupRepository {
  private readonly orm: ReturnType<typeof drizzle>;

  constructor(db: D1Database) {
    this.orm = drizzle(db);
  }

  public async listDueForCleanup(): Promise<TenantRow[]> {
    const rows = await this.orm.select({
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
        .where(and(
            eq(users.is_active, 1),
            eq(users.is_data_cleared, 0),
            ne(users.role, 'admin'),
            expiryDueCondition,
        ))
        .all();
    return rows as unknown as TenantRow[];
  }

  public async findById(id: string): Promise<TenantRow | null> {
    const row = await this.orm.select({
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
    const row = await this.orm.select({
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
    await this.orm.update(users)
        .set({
          is_data_cleared: 1,
          last_cleanup_at: nowIso(),
          data_size_estimate: dataSizeEstimate,
        })
        .where(eq(users.tenant_id, tenantId))
        .run();
  }
}
