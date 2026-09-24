/**
 * @fileoverview D1 implementation of {@link UserRepository} over `idn_user`
 * and `idn_tenant`.
 */

import {AppError, isRole} from '@ontodecide/shared-kernel';
import type {TenantRecord, UserRepository} from '../application';
import {User, type UserState} from '../domain';

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  pwd_hash: string;
  pwd_salt: string;
  role: string;
  markings: string;
  locale: string;
  disabled: number;
  must_change_pwd: number;
  failed_attempts: number;
  locked_until: number | null;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

const COLUMNS =
  'id, tenant_id, email, name, pwd_hash, pwd_salt, role, markings, locale, ' +
  'disabled, must_change_pwd, failed_attempts, locked_until, last_login_at, ' +
  'created_at, updated_at';

function parseMarkings(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(m => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

function toUser(row: UserRow): User {
  if (!isRole(row.role)) {
    throw new AppError('INTERNAL', `Invalid role stored for user ${row.id}`);
  }
  const state: UserState = {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    pwdHash: row.pwd_hash,
    pwdSalt: row.pwd_salt,
    role: row.role,
    markings: parseMarkings(row.markings),
    locale: row.locale,
    disabled: row.disabled === 1,
    mustChangePassword: row.must_change_pwd === 1,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until ?? null,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return User.restore(state);
}

function insertValues(s: Readonly<UserState>): unknown[] {
  return [
    s.id,
    s.tenantId,
    s.email,
    s.name,
    s.pwdHash,
    s.pwdSalt,
    s.role,
    JSON.stringify(s.markings),
    s.locale,
    s.disabled ? 1 : 0,
    s.mustChangePassword ? 1 : 0,
    s.failedAttempts,
    s.lockedUntil,
    s.lastLoginAt,
    s.createdAt,
    s.updatedAt,
  ];
}

const PLACEHOLDERS = Array(16).fill('?').join(', ');

function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

/** Users in D1. */
export class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async countAll(): Promise<number> {
    const n = await this.db
      .prepare('SELECT COUNT(*) AS n FROM idn_user')
      .first<number>('n');
    return Number(n ?? 0);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM idn_user WHERE email = ?`)
      .bind(email)
      .first<UserRow>();
    return row ? toUser(row) : null;
  }

  async findById(tenantId: string, id: string): Promise<User | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM idn_user WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .first<UserRow>();
    return row ? toUser(row) : null;
  }

  async listByTenant(tenantId: string): Promise<User[]> {
    const {results} = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM idn_user WHERE tenant_id = ? ORDER BY created_at, id`,
      )
      .bind(tenantId)
      .all<UserRow>();
    return results.map(toUser);
  }

  async countActiveAdmins(tenantId: string): Promise<number> {
    const n = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM idn_user WHERE tenant_id = ? AND role = 'Admin' AND disabled = 0",
      )
      .bind(tenantId)
      .first<number>('n');
    return Number(n ?? 0);
  }

  async insert(user: User): Promise<void> {
    try {
      await this.db
        .prepare(`INSERT INTO idn_user (${COLUMNS}) VALUES (${PLACEHOLDERS})`)
        .bind(...insertValues(user.state))
        .run();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppError('CONFLICT', 'Email already in use');
      }
      throw e;
    }
  }

  async save(user: User): Promise<void> {
    const s = user.state;
    await this.db
      .prepare(
        'UPDATE idn_user SET name = ?, pwd_hash = ?, pwd_salt = ?, role = ?, ' +
          'markings = ?, locale = ?, disabled = ?, must_change_pwd = ?, ' +
          'failed_attempts = ?, locked_until = ?, last_login_at = ?, updated_at = ? ' +
          'WHERE tenant_id = ? AND id = ?',
      )
      .bind(
        s.name,
        s.pwdHash,
        s.pwdSalt,
        s.role,
        JSON.stringify(s.markings),
        s.locale,
        s.disabled ? 1 : 0,
        s.mustChangePassword ? 1 : 0,
        s.failedAttempts,
        s.lockedUntil,
        s.lastLoginAt,
        s.updatedAt,
        s.tenantId,
        s.id,
      )
      .run();
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM idn_user WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, id)
      .run();
  }

  async bootstrap(tenant: TenantRecord, admin: User): Promise<boolean> {
    const empty = 'WHERE NOT EXISTS (SELECT 1 FROM idn_user)';
    const [, userRes] = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO idn_tenant (id, name, created_at) SELECT ?, ?, ? ${empty}`,
        )
        .bind(tenant.id, tenant.name, tenant.createdAt),
      this.db
        .prepare(
          `INSERT INTO idn_user (${COLUMNS}) SELECT ${PLACEHOLDERS} ${empty}`,
        )
        .bind(...insertValues(admin.state)),
    ]);
    return (userRes.meta.changes ?? 0) > 0;
  }
}
