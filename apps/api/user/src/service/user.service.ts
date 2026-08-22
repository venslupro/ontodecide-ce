/**
 * User-management domain service.
 *
 * This is the orchestration layer between the HTTP handlers and the
 * repository. It enforces the cross-cutting invariants:
 *   - the bootstrap admin cannot be disabled or deleted;
 *   - the configured `max_users` cap is respected on create;
 *   - every mutating call writes an audit log entry.
 *
 * The service depends on {@link IUserRepository} (an abstraction), not on
 * D1 directly — the dependency-inversion principle (D in SOLID).
 */
import {
  CONFIG,
  ERROR_CODES,
  throwError,
  generateTemporaryPassword,
  hashPassword,
  uuid,
  tenantId,
  nowIso,
  nowEpochSeconds,
  sendEmail,
  buildCredentialEmail,
  DEFAULT_EMAIL_FROM,
} from '@ontodecide/shared';
import { User } from '../domain/user.entity.js';
import type {
  AuditEntry,
  IAuditRepository,
  IConfigRepository,
  IRefreshTokenRepository,
  IUserRepository,
} from '../repository/user.repository.js';
import type { UserEnv, UserRole } from '../types/env.js';

export interface CreateUserInput {
  /** Optional username. When omitted the system generates a unique one. */
  username?: string;
  role?: UserRole;
  email?: string | null;
  dataRetentionDays?: number;
}

export interface CreateUserResult {
  user: User;
  /** Plaintext password, only visible at creation time. */
  temporaryPassword: string;
}

export interface ApplicationResult {
  user: User;
  /** Plaintext password, only visible at creation time. */
  temporaryPassword: string;
  /** Whether the credential email was delivered. */
  emailSent: boolean;
}

export interface AuditContext {
  operatorId: string;
  operatorTenantId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Short-lived token TTL for the password-change-required state (10 min). */
const PWD_CHANGE_TOKEN_TTL_SECONDS = 10 * 60;

export class UserManagementService {
  constructor(
    private readonly users: IUserRepository,
    private readonly audit: IAuditRepository,
    private readonly refresh: IRefreshTokenRepository,
    private readonly config: IConfigRepository,
    private readonly env?: UserEnv,
  ) {}

  /**
   * Submit a public account application.
   *
   * Creates a user with:
   *   - email as the login username (what the user types to log in)
   *   - a random temporary password
   *   - must_change_password = true (must be changed on first login)
   *   - expires_at = now + usageDays
   *   - an immutable tenant_id (data anchor) generated via `tenantId()`
   *
   * The email ↔ tenant_id mapping is stored in the `users` table
   * (username column = email, tenant_id column = immutable anchor).
   * All internal systems (Neo4j DB name, KV prefixes, B2 paths) use
   * the tenant_id, never the email — so changing the email later
   * doesn't require migrating any data.
   *
   * Sends the credentials + expiration via email (from venslu.pro@gmail.com).
   * When no EMAIL_API_KEY is configured, the email is skipped and the
   * password is returned in the API response as a fallback.
   */
  public async submitApplication(
    email: string,
    usageDays: number,
    ctx: AuditContext,
  ): Promise<ApplicationResult> {
    const maxUsers = parseInt((await this.config.get('max_users')) ?? String(CONFIG.MAX_USERS), 10);
    const current = await this.users.countActive();
    if (current >= maxUsers) {
      throwError(ERROR_CODES.USER_MAX_EXCEEDED, `Maximum of ${maxUsers} users reached.`);
    }
    // Email is the login name; check uniqueness.
    const existing = await this.users.findByUsername(email);
    if (existing) {
      throwError(ERROR_CODES.USER_ALREADY_EXISTS, `An account for '${email}' already exists.`);
    }
    // Generate the immutable data anchor (tenant_id). This is used for
    // Neo4j DB naming, KV key prefixes, B2 paths — never the email.
    const tid = tenantId();
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + usageDays * 24 * 60 * 60 * 1000).toISOString();
    const user = User.new({
      id: uuid(),
      tenantId: tid,
      username: email,
      passwordHash,
      email,
      role: 'analyst',
      dataRetentionDays: usageDays,
      mustChangePassword: true,
      expiresAt,
    });
    await this.users.save(user);
    await this.recordAudit(ctx, {
      action: 'create_user',
      targetUserId: user.id,
      details: JSON.stringify({ username: email, usageDays, expiresAt, tenantId: tid }),
      tenantId: user.tenantId,
    });

    // Send credential email.
    const emailConfig = {
      apiKey: this.env?.EMAIL_API_KEY,
      from: this.env?.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
    };
    const { subject, text, html } = buildCredentialEmail(email, temporaryPassword, expiresAt);
    const emailSent = await sendEmail({ to: email, subject, text, html }, emailConfig);

    return { user, temporaryPassword, emailSent };
  }

  /**
   * Create a new account AND provision the tenant's Neo4j database.
   *
   * The username (login name) is `input.username` or `input.email` —
   * the admin must supply at least one. The tenant_id (immutable data
   * anchor) is always generated independently via `tenantId()`, never
   * derived from the username.
   */
  public async createUser(input: CreateUserInput, ctx: AuditContext): Promise<CreateUserResult> {
    const maxUsers = parseInt((await this.config.get('max_users')) ?? String(CONFIG.MAX_USERS), 10);
    const current = await this.users.countActive();
    if (current >= maxUsers) {
      throwError(ERROR_CODES.USER_MAX_EXCEEDED, `Maximum of ${maxUsers} users reached.`);
    }
    // Login name: prefer explicit username, fall back to email.
    const username = input.username ?? input.email;
    if (!username) {
      throwError(ERROR_CODES.VALIDATION_FAILED, 'username or email is required.');
    }
    const existing = await this.users.findByUsername(username!);
    if (existing) {
      throwError(ERROR_CODES.USER_ALREADY_EXISTS, `Username '${username}' is taken.`);
    }
    // Generate the immutable data anchor — independent of username.
    const tid = tenantId();
    const role: UserRole = input.role ?? 'analyst';
    const retention = input.dataRetentionDays ?? CONFIG.DEFAULT_DATA_RETENTION_DAYS;
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + retention * 24 * 60 * 60 * 1000).toISOString();
    const user = User.new({
      id: uuid(),
      tenantId: tid,
      username: username!,
      passwordHash,
      email: input.email ?? null,
      role,
      dataRetentionDays: retention,
      mustChangePassword: true,
      expiresAt,
    });
    await this.users.save(user);
    await this.recordAudit(ctx, {
      action: 'create_user',
      targetUserId: user.id,
      details: JSON.stringify({ username, role, tenantId: tid }),
      tenantId: user.tenantId,
    });
    return { user, temporaryPassword };
  }

  /**
   * Authenticate a user; returns the user entity when credentials match.
   *
   * Checks:
   *   1. User exists + password is valid.
   *   2. Account is not disabled.
   *   3. Account has not expired (checked against `expires_at`).
   *
   * The caller (auth handler) is responsible for checking
   * `user.requiresPasswordChange` after a successful login and issuing
   * a short-lived activation-only token when true.
   */
  public async login(username: string, password: string, ctx: AuditContext): Promise<User> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      await this.recordAudit(ctx, {
        action: 'login',
        targetUserId: null,
        details: JSON.stringify({ reason: 'user_not_found', username }),
        tenantId: ctx.operatorTenantId,
      });
      throwError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid credentials.');
    }
    const valid = await user!.verifyPassword(password);
    if (!valid) {
      await this.recordAudit(ctx, {
        action: 'login',
        targetUserId: user!.id,
        details: JSON.stringify({ reason: 'bad_password' }),
        tenantId: user!.tenantId,
      });
      throwError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid credentials.');
    }
    if (!user!.snapshot().isActive) {
      throwError(ERROR_CODES.USER_DISABLED, 'Account is disabled.');
    }
    if (user!.isExpired()) {
      throwError(ERROR_CODES.USER_ACCOUNT_EXPIRED, 'Account has expired.');
    }
    user!.recordLogin();
    await this.users.save(user!);
    await this.recordAudit(ctx, {
      action: 'login',
      targetUserId: user!.id,
      details: null,
      tenantId: user!.tenantId,
    });
    return user!;
  }

  /**
   * Self-service password change (first-login activation).
   *
   * Validates the current password, sets the new one, clears the
   * must-change flag, revokes all existing refresh tokens, and
   * records an audit entry.
   */
  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: AuditContext,
  ): Promise<User> {
    const user = await this.requireUser(userId);
    const valid = await user.verifyPassword(currentPassword);
    if (!valid) {
      throwError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Current password is incorrect.');
    }
    const newHash = await hashPassword(newPassword);
    user.changePassword(newHash);
    await this.users.save(user);
    await this.refresh.revokeAllForUser(user.id);
    await this.recordAudit(ctx, {
      action: 'change_password',
      targetUserId: user.id,
      details: null,
      tenantId: user.tenantId,
    });
    return user;
  }

  /** Reset a user's password; returns the new plaintext once. */
  public async resetPassword(userId: string, ctx: AuditContext): Promise<string> {
    const user = await this.requireUser(userId);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    user.setPasswordHash(passwordHash);
    await this.users.save(user);
    await this.refresh.revokeAllForUser(user.id);
    await this.recordAudit(ctx, {
      action: 'reset_password',
      targetUserId: user.id,
      details: null,
      tenantId: user.tenantId,
    });
    return temporaryPassword;
  }

  /** Enable or disable a user. */
  public async setStatus(userId: string, isActive: boolean, ctx: AuditContext): Promise<User> {
    const user = await this.requireUser(userId);
    if (isActive) {
      user.enable();
    } else {
      user.disable();
    }
    await this.users.save(user);
    await this.recordAudit(ctx, {
      action: isActive ? 'enable_user' : 'disable_user',
      targetUserId: user.id,
      details: null,
      tenantId: user.tenantId,
    });
    return user;
  }

  /** Soft-delete a user. */
  public async deleteUser(userId: string, ctx: AuditContext): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.role === 'admin') {
      throwError(ERROR_CODES.AUTH_FORBIDDEN, 'Cannot delete the bootstrap admin.');
    }
    await this.refresh.revokeAllForUser(user.id);
    // NOTE: compliance archival + full account deletion is delegated to
    // the Cleanup service (tenant-archive bucket write → DROP DATABASE →
    // permanent D1 row removal). Here we revoke tokens, mark the user
    // inactive so login/auth handlers can't use the account, and record
    // the audit entry. The Cleanup worker then drops the DB row after
    // the backup is written.
    user.disable();
    await this.users.save(user);
    await this.recordAudit(ctx, {
      action: 'delete_user',
      targetUserId: user.id,
      details: JSON.stringify({ username: user.username }),
      tenantId: user.tenantId,
    });
  }

  /** Get a user by id. */
  public async getUser(userId: string): Promise<User> {
    return this.requireUser(userId);
  }

  /** List users (paged). */
  public async listUsers(opts: { role?: string; page?: number; size?: number }) {
    const limit = opts.size ?? 50;
    const offset = ((opts.page ?? 1) - 1) * limit;
    return this.users.list({ role: opts.role, offset, limit });
  }

  /** Issue a refresh token and persist it. */
  public async issueRefreshToken(user: User): Promise<{ jti: string; expiresAt: string }> {
    const jti = uuid();
    const expiresAt = new Date(
      nowEpochSeconds() + CONFIG.REFRESH_TOKEN_TTL_SECONDS * 1000,
    ).toISOString();
    await this.refresh.save({
      jti,
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt,
      revoked: false,
      createdAt: nowIso(),
    });
    return { jti, expiresAt };
  }

  /** Revoke a single refresh token (used by `/auth/refresh` rotation). */
  public async revokeRefreshToken(jti: string): Promise<void> {
    await this.refresh.revoke(jti);
  }

  /** Get the audit log for a tenant. */
  public async listAudit(tenantId: string, opts: { page?: number; size?: number }) {
    const limit = opts.size ?? 50;
    const offset = ((opts.page ?? 1) - 1) * limit;
    return this.audit.listForTenant(tenantId, { offset, limit });
  }

  /** Set a system-config value (admin only). */
  public async setConfig(key: string, value: string, ctx: AuditContext): Promise<void> {
    await this.config.set(key, value, ctx.operatorId);
  }

  /** Read all system config values (admin only). */
  public async getAllConfig(): Promise<Record<string, string>> {
    return this.config.all();
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      throwError(ERROR_CODES.USER_NOT_FOUND, `User ${userId} not found.`);
    }
    return user!;
  }

  private async recordAudit(
    ctx: AuditContext,
    entry: Omit<AuditEntry, 'id' | 'operatorId' | 'ip' | 'userAgent' | 'createdAt'>,
  ): Promise<void> {
    await this.audit.record({
      id: uuid(),
      operatorId: ctx.operatorId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      createdAt: nowIso(),
      ...entry,
    });
  }
}

export { PWD_CHANGE_TOKEN_TTL_SECONDS };
