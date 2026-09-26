/**
 * @fileoverview Ports of the identity application layer. Infrastructure
 * provides the implementations (D1, WebCrypto).
 */

import type {RefreshTokenRecord, User} from '../domain';

/** A tenant row. */
export interface TenantRecord {
  id: string;
  name: string;
  /** Epoch ms. */
  createdAt: number;
}

/** Persistence of users. All queries are tenant-scoped except where noted. */
export interface UserRepository {
  /** Number of users across all tenants (bootstrap check only). */
  countAll(): Promise<number>;
  /**
   * Finds a user by normalized email. Emails are globally unique, so login
   * (which has no tenant yet) looks users up across tenants.
   */
  findByEmail(email: string): Promise<User | null>;
  findById(tenantId: string, id: string): Promise<User | null>;
  listByTenant(tenantId: string): Promise<User[]>;
  countActiveAdmins(tenantId: string): Promise<number>;
  /** Inserts a user; throws CONFLICT when the email is taken. */
  insert(user: User): Promise<void>;
  /** Persists changes of an existing user (scoped by its tenant). */
  save(user: User): Promise<void>;
  delete(tenantId: string, id: string): Promise<void>;
  /**
   * Atomically creates the first tenant and its admin, only if no user
   * exists yet. Returns false when another user already exists.
   */
  bootstrap(tenant: TenantRecord, admin: User): Promise<boolean>;
}

/** Persistence of hashed refresh tokens. */
export interface TokenRepository {
  insert(record: RefreshTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /**
   * Marks a live token rotated. Returns false if it was already rotated or
   * revoked (a concurrent refresh), which callers treat as replay.
   */
  markRotated(tokenHash: string): Promise<boolean>;
  revokeFamily(family: string): Promise<void>;
  revokeAllForUser(tenantId: string, userId: string): Promise<void>;
  deleteAllForUser(tenantId: string, userId: string): Promise<void>;
}

/** Security audit events. */
export type AuditEvent =
  | 'auth.login_failed'
  | 'auth.locked'
  | 'auth.bootstrap'
  | 'auth.refresh_replay'
  | 'user.created'
  | 'user.role_changed'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.markings_changed'
  | 'user.password_reset'
  | 'user.password_changed'
  | 'user.deleted';

/** An audit entry. Never contains passwords or tokens. */
export interface AuditEntry {
  tenantId: string | null;
  actor: string | null;
  event: AuditEvent;
  subject?: string | null;
  detail?: Record<string, unknown>;
}

/** Append-only security audit log. */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

/** A stored password hash. */
export interface PasswordHash {
  hash: string;
  salt: string;
}

/** Password hashing (PBKDF2 in production). */
export interface PasswordHasher {
  hash(password: string): Promise<PasswordHash>;
  verify(password: string, stored: PasswordHash): Promise<boolean>;
}

/** Signs access tokens (JWT). */
export interface TokenSigner {
  /** Returns a signed access JWT for the user, issued at `now`. */
  signAccessToken(user: User, now: Date): Promise<string>;
}
