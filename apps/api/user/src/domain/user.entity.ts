/**
 * User aggregate root (DDD domain layer).
 *
 * Encapsulates the invariants and lifecycle transitions described in
 * the design doc §4.2.1:
 *   pending → active → disabled → active
 *   active → data_cleared → active (re-ingest)
 *
 * The entity exposes behaviour rather than exposing its state directly:
 * callers must use {@link disable}, {@link enable}, {@link markCleared} to
 * mutate status. This keeps the state-machine logic in one place and
 * makes the repository's job simpler.
 */
import type {UserDbRow, UserRole} from '../types/env.js';

export type UserState = 'pending' | 'active' | 'disabled' | 'data_cleared';

/** Public projection of a user (no password hash). */
export interface UserSnapshot {
  id: string;
  tenantId: string;
  username: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  isDataCleared: boolean;
  mustChangePassword: boolean;
  expiresAt: string | null;
  state: UserState;
  createdAt: string;
  lastLoginAt: string | null;
  lastCleanupAt: string | null;
  dataRetentionDays: number;
  dataSizeEstimate: number;
}

/**
 * Aggregate root for the User bounded context.
 *
 * Constructed via {@link User.fromRow} from a D1 row; never instantiated
 * directly from outside the domain layer.
 */
export class User {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly username: string;
  private passwordHash: string;
  public email: string | null;
  public role: UserRole;
  private active: boolean;
  private dataCleared: boolean;
  private mustChangePassword: boolean;
  public expiresAt: string | null;
  public readonly createdAt: string;
  public lastLoginAt: string | null;
  public lastCleanupAt: string | null;
  public dataRetentionDays: number;
  public dataSizeEstimate: number;

  private constructor(row: UserDbRow) {
    this.id = row.id;
    this.tenantId = row.tenant_id;
    this.username = row.username;
    this.passwordHash = row.password_hash;
    this.email = row.email;
    this.role = row.role;
    this.active = row.is_active === 1;
    this.dataCleared = row.is_data_cleared === 1;
    this.mustChangePassword = row.must_change_password === 1;
    this.expiresAt = row.expires_at ?? null;
    this.createdAt = row.created_at;
    this.lastLoginAt = row.last_login_at;
    this.lastCleanupAt = row.last_cleanup_at;
    this.dataRetentionDays = row.data_retention_days;
    this.dataSizeEstimate = row.data_size_estimate;
  }

  /** Rehydrate from a D1 row. */
  public static fromRow(row: UserDbRow): User {
    return new User(row);
  }

  /** Construct a new (un-persisted) user with the given password hash. */
  public static new(params: {
    id: string;
    tenantId: string;
    username: string;
    passwordHash: string;
    email: string | null;
    role: UserRole;
    dataRetentionDays: number;
    mustChangePassword?: boolean;
    expiresAt?: string | null;
  }): User {
    const now = new Date().toISOString();
    return new User({
      id: params.id,
      tenant_id: params.tenantId,
      username: params.username,
      password_hash: params.passwordHash,
      email: params.email,
      role: params.role,
      is_active: 1,
      is_data_cleared: 0,
      must_change_password: params.mustChangePassword ? 1 : 0,
      expires_at: params.expiresAt ?? null,
      created_by: null,
      created_at: now,
      last_login_at: null,
      last_cleanup_at: null,
      data_retention_days: params.dataRetentionDays,
      data_size_estimate: 0,
      metadata: null,
    });
  }

  /** Public projection safe to return to clients. */
  public snapshot(): UserSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantId,
      username: this.username,
      email: this.email,
      role: this.role,
      isActive: this.active,
      isDataCleared: this.dataCleared,
      mustChangePassword: this.mustChangePassword,
      expiresAt: this.expiresAt,
      state: this.state(),
      createdAt: this.createdAt,
      lastLoginAt: this.lastLoginAt,
      lastCleanupAt: this.lastCleanupAt,
      dataRetentionDays: this.dataRetentionDays,
      dataSizeEstimate: this.dataSizeEstimate,
    };
  }

  /** Lifecycle state derived from the active / cleared flags. */
  public state(): UserState {
    if (!this.active) return 'disabled';
    if (this.dataCleared) return 'data_cleared';
    if (this.lastLoginAt === null) return 'pending';
    return 'active';
  }

  /** True when the supplied plaintext password verifies against the hash. */
  public async verifyPassword(plaintext: string): Promise<boolean> {
    const {verifyPassword} = await import('@ontodecide/shared');
    return verifyPassword(plaintext, this.passwordHash);
  }

  /** Set a new password hash (after admin reset or self-service change). */
  public setPasswordHash(hash: string): void {
    this.passwordHash = hash;
  }

  /** Whether the user must change their password before using the system. */
  public get requiresPasswordChange(): boolean {
    return this.mustChangePassword;
  }

  /**
   * Change the password and clear the must-change flag (activation).
   * Called by the self-service change-password handler on first login.
   */
  public changePassword(newHash: string): void {
    this.passwordHash = newHash;
    this.mustChangePassword = false;
  }

  /** Check whether the account has expired. */
  public isExpired(now: Date = new Date()): boolean {
    if (!this.expiresAt) return false;
    return now.getTime() >= new Date(this.expiresAt).getTime();
  }

  /** Record a successful login (called by the auth handler). */
  public recordLogin(): void {
    this.lastLoginAt = new Date().toISOString();
    // After a login the user is implicitly "active" again even if a
    // previous data-clear left them in the data_cleared state — the
    // account shell is still valid and the user can re-ingest data.
    this.dataCleared = false;
  }

  /** Disable the account. */
  public disable(): void {
    if (this.role === 'admin') {
      throw new Error('The bootstrap admin cannot be disabled.');
    }
    this.active = false;
  }

  /** Re-enable a previously disabled account. */
  public enable(): void {
    this.active = true;
  }

  /** Mark the account's data as cleared (called by Cleanup Service). */
  public markCleared(): void {
    this.dataCleared = true;
    this.lastCleanupAt = new Date().toISOString();
    this.dataSizeEstimate = 0;
  }

  /** Update the email / retention fields. */
  public updateProfile(params: {email?: string; dataRetentionDays?: number}): void {
    if (params.email !== undefined) this.email = params.email;
    if (params.dataRetentionDays !== undefined) {
      this.dataRetentionDays = params.dataRetentionDays;
    }
  }

  /** Get the row representation for persistence. */
  public toRow(): UserDbRow {
    return {
      id: this.id,
      tenant_id: this.tenantId,
      username: this.username,
      password_hash: this.passwordHash,
      email: this.email,
      role: this.role,
      is_active: this.active ? 1 : 0,
      is_data_cleared: this.dataCleared ? 1 : 0,
      must_change_password: this.mustChangePassword ? 1 : 0,
      expires_at: this.expiresAt,
      created_by: null,
      created_at: this.createdAt,
      last_login_at: this.lastLoginAt,
      last_cleanup_at: this.lastCleanupAt,
      data_retention_days: this.dataRetentionDays,
      data_size_estimate: this.dataSizeEstimate,
      metadata: null,
    };
  }
}
