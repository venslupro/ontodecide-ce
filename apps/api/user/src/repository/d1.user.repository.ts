/**
 * D1-backed implementation of {@link IUserRepository} using Drizzle ORM.
 *
 * All queries are built with the Drizzle query builder, providing
 * type-safe database access. Complex business logic lives in the
 * domain service.
 */
import {count, eq, sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/d1';
import {users, auditLogs, systemConfig, refreshTokens} from '@ontodecide/shared/db';
import type {
  IAuditRepository,
  AuditEntry,
  IConfigRepository,
  IRefreshTokenRepository,
  IUserRepository,
  RefreshTokenRecord,
} from './user.repository.js';
import {User} from '../domain/user.entity.js';
import type {UserSnapshot} from '../domain/user.entity.js';
import type {UserDbRow} from '../types/env.js';

export class D1UserRepository implements IUserRepository {
  private readonly db;

  constructor(db: D1Database) {
    this.db = drizzle(db);
  }

  public async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users)
        .where(eq(users.id, id)).limit(1).all();
    return rows[0] ? User.fromRow(rows[0] as unknown as UserDbRow) : null;
  }

  public async findByUsername(username: string): Promise<User | null> {
    const rows = await this.db.select().from(users)
        .where(eq(users.username, username)).limit(1).all();
    return rows[0] ? User.fromRow(rows[0] as unknown as UserDbRow) : null;
  }

  public async findByTenant(tenantId: string): Promise<User | null> {
    const rows = await this.db.select().from(users)
        .where(eq(users.tenant_id, tenantId)).limit(1).all();
    return rows[0] ? User.fromRow(rows[0] as unknown as UserDbRow) : null;
  }

  public async list(opts: {
    role?: string;
    offset?: number;
    limit?: number;
  } = {}): Promise<{total: number; items: UserSnapshot[]}> {
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));

    const where = opts.role ? eq(users.role, opts.role) : undefined;

    const countRow = await this.db.select({total: count()})
        .from(users).where(where).get();
    const total = countRow?.total ?? 0;

    const rows = await this.db.select().from(users)
        .where(where)
        .orderBy(sql`${users.created_at} DESC`)
        .limit(limit).offset(offset).all();

    return {
      total,
      items: rows.map((row) =>
        User.fromRow(row as unknown as UserDbRow).snapshot()),
    };
  }

  public async save(user: User): Promise<void> {
    const row = user.toRow();
    await this.db.insert(users)
        .values({
          id: row.id,
          tenant_id: row.tenant_id,
          username: row.username,
          password_hash: row.password_hash,
          email: row.email,
          role: row.role,
          is_active: row.is_active ? 1 : 0,
          is_data_cleared: row.is_data_cleared ? 1 : 0,
          created_by: row.created_by,
          created_at: row.created_at,
          last_login_at: row.last_login_at,
          last_cleanup_at: row.last_cleanup_at,
          data_retention_days: row.data_retention_days,
          data_size_estimate: row.data_size_estimate,
          metadata: row.metadata,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            password_hash: row.password_hash,
            email: row.email,
            role: row.role,
            is_active: row.is_active ? 1 : 0,
            is_data_cleared: row.is_data_cleared ? 1 : 0,
            last_login_at: row.last_login_at,
            last_cleanup_at: row.last_cleanup_at,
            data_retention_days: row.data_retention_days,
            data_size_estimate: row.data_size_estimate,
            metadata: row.metadata,
          },
        })
        .run();
  }

  public async delete(id: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, id)).run();
  }

  public async count(): Promise<number> {
    const row = await this.db.select({total: count()})
        .from(users)
        .where(sql`${users.role} != 'admin'`)
        .get();
    return row?.total ?? 0;
  }
}

/** D1-backed audit repository. */
export class D1AuditRepository implements IAuditRepository {
  private readonly db;

  constructor(db: D1Database) {
    this.db = drizzle(db);
  }

  public async record(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLogs)
        .values({
          id: entry.id,
          tenant_id: entry.tenantId,
          operator_id: entry.operatorId,
          action: entry.action,
          target_user_id: entry.targetUserId,
          details: entry.details,
          ip: entry.ip,
          user_agent: entry.userAgent,
          created_at: entry.createdAt,
        })
        .run();
  }

  public async listForTenant(
      tenantId: string,
      opts: {offset?: number; limit?: number} = {},
  ): Promise<{total: number; items: AuditEntry[]}> {
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));

    const countRow = await this.db.select({total: count()})
        .from(auditLogs)
        .where(eq(auditLogs.tenant_id, tenantId))
        .get();
    const total = countRow?.total ?? 0;

    const rows = await this.db.select().from(auditLogs)
        .where(eq(auditLogs.tenant_id, tenantId))
        .orderBy(sql`${auditLogs.created_at} DESC`)
        .limit(limit).offset(offset).all();

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        operatorId: row.operator_id,
        action: row.action as AuditEntry['action'],
        targetUserId: row.target_user_id,
        details: row.details,
        ip: row.ip,
        userAgent: row.user_agent,
        createdAt: row.created_at,
      })),
    };
  }
}

/** D1-backed refresh-token repository. */
export class D1RefreshTokenRepository implements IRefreshTokenRepository {
  private readonly db;

  constructor(db: D1Database) {
    this.db = drizzle(db);
  }

  public async save(token: RefreshTokenRecord): Promise<void> {
    await this.db.insert(refreshTokens)
        .values({
          jti: token.jti,
          user_id: token.userId,
          tenant_id: token.tenantId,
          expires_at: token.expiresAt,
          revoked: token.revoked ? 1 : 0,
          created_at: token.createdAt,
        })
        .run();
  }

  public async find(jti: string): Promise<RefreshTokenRecord | null> {
    const rows = await this.db.select().from(refreshTokens)
        .where(eq(refreshTokens.jti, jti)).limit(1).all();
    const row = rows[0];
    if (!row) return null;
    return {
      jti: row.jti,
      userId: row.user_id,
      tenantId: row.tenant_id,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      createdAt: row.created_at,
    };
  }

  public async revoke(jti: string): Promise<void> {
    await this.db.update(refreshTokens)
        .set({revoked: 1})
        .where(eq(refreshTokens.jti, jti))
        .run();
  }

  public async revokeAllForUser(userId: string): Promise<void> {
    await this.db.update(refreshTokens)
        .set({revoked: 1})
        .where(eq(refreshTokens.user_id, userId))
        .run();
  }
}

/** D1-backed system-config repository. */
export class D1ConfigRepository implements IConfigRepository {
  private readonly db;

  constructor(db: D1Database) {
    this.db = drizzle(db);
  }

  public async get(key: string): Promise<string | null> {
    const rows = await this.db.select({value: systemConfig.value})
        .from(systemConfig)
        .where(eq(systemConfig.key, key))
        .limit(1).all();
    return rows[0]?.value ?? null;
  }

  public async set(key: string, value: string, updatedBy: string): Promise<void> {
    await this.db.insert(systemConfig)
        .values({
          key,
          value,
          updated_at: sql`(datetime('now'))`,
          updated_by: updatedBy,
        })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: {
            value,
            updated_at: sql`(datetime('now'))`,
            updated_by: updatedBy,
          },
        })
        .run();
  }

  public async all(): Promise<Record<string, string>> {
    const rows = await this.db.select({
      key: systemConfig.key,
      value: systemConfig.value,
    }).from(systemConfig).all();
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.key] = row.value;
    }
    return out;
  }
}
