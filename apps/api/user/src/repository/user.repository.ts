/**
 * Repository interfaces (dependency-inversion layer).
 *
 * The domain service depends on {@link IUserRepository}, not on the D1
 * implementation. This keeps the domain free of Cloudflare-specific
 * types and makes the service unit-testable with an in-memory fake.
 */
import type { User } from '../domain/user.entity.js';
import type { UserSnapshot } from '../domain/user.entity.js';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByTenant(tenantId: string): Promise<User | null>;
  list(opts?: { role?: string; offset?: number; limit?: number }): Promise<{
    total: number;
    items: UserSnapshot[];
  }>;
  save(user: User): Promise<void>;
  delete(id: string): Promise<void>;
  /** Count current users (excluding the bootstrap admin). */
  count(): Promise<number>;
  /** Count active, non-cleared users (excluding the bootstrap admin). */
  countActive(): Promise<number>;
}

/** Audit-log repository (write-mostly). */
export interface IAuditRepository {
  record(entry: AuditEntry): Promise<void>;
  listForTenant(
    tenantId: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<{ total: number; items: AuditEntry[] }>;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  operatorId: string;
  action:
    | 'create_user'
    | 'disable_user'
    | 'enable_user'
    | 'reset_password'
    | 'change_password'
    | 'cleanup_data'
    | 'login'
    | 'logout'
    | 'delete_user';
  targetUserId: string | null;
  details: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Refresh-token repository. */
export interface IRefreshTokenRepository {
  save(token: RefreshTokenRecord): Promise<void>;
  find(jti: string): Promise<RefreshTokenRecord | null>;
  revoke(jti: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export interface RefreshTokenRecord {
  jti: string;
  userId: string;
  tenantId: string;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

/** System-config repository (key/value pairs). */
export interface IConfigRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, updatedBy: string): Promise<void>;
  all(): Promise<Record<string, string>>;
}
