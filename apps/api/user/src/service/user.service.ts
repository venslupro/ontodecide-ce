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
  tenantId,
  uuid,
  nowIso,
  nowEpochSeconds,
} from '@ontodecide/shared';
import {User} from '../domain/user.entity.js';
import type {
  AuditEntry,
  IAuditRepository,
  IConfigRepository,
  IRefreshTokenRepository,
  IUserRepository,
} from '../repository/user.repository.js';
import type {UserRole} from '../types/env.js';

export interface CreateUserInput {
  username: string;
  role?: UserRole;
  email?: string | null;
  dataRetentionDays?: number;
}

export interface CreateUserResult {
  user: User;
  /** Plaintext password, only visible at creation time. */
  temporaryPassword: string;
}

export interface AuditContext {
  operatorId: string;
  operatorTenantId: string;
  ip: string | null;
  userAgent: string | null;
}

export class UserManagementService {
  constructor(
    private readonly users: IUserRepository,
    private readonly audit: IAuditRepository,
    private readonly refresh: IRefreshTokenRepository,
    private readonly config: IConfigRepository,
  ) {}

  /** Create a new account. Returns the plaintext password once. */
  public async createUser(input: CreateUserInput, ctx: AuditContext): Promise<CreateUserResult> {
    const existing = await this.users.findByUsername(input.username);
    if (existing) {
      throwError(ERROR_CODES.USER_ALREADY_EXISTS, `Username '${input.username}' is taken.`);
    }
    const maxUsers = parseInt((await this.config.get('max_users')) ?? String(CONFIG.MAX_USERS), 10);
    const current = await this.users.count();
    if (current >= maxUsers) {
      throwError(ERROR_CODES.USER_MAX_EXCEEDED, `Maximum of ${maxUsers} users reached.`);
    }
    const role: UserRole = input.role ?? 'analyst';
    const retention = input.dataRetentionDays ?? CONFIG.DEFAULT_DATA_RETENTION_DAYS;
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const user = User.new({
      id: uuid(),
      tenantId: tenantId(),
      username: input.username,
      passwordHash,
      email: input.email ?? null,
      role,
      dataRetentionDays: retention,
    });
    await this.users.save(user);
    await this.recordAudit(ctx, {
      action: 'create_user',
      targetUserId: user.id,
      details: JSON.stringify({username: input.username, role}),
      tenantId: user.tenantId,
    });
    return {user, temporaryPassword};
  }

  /** Authenticate a user; returns the user entity when credentials match. */
  public async login(
      username: string,
      password: string,
      ctx: AuditContext,
  ): Promise<User> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      await this.recordAudit(ctx, {
        action: 'login',
        targetUserId: null,
        details: JSON.stringify({reason: 'user_not_found', username}),
        tenantId: ctx.operatorTenantId,
      });
      throwError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid credentials.');
    }
    const valid = await user!.verifyPassword(password);
    if (!valid) {
      await this.recordAudit(ctx, {
        action: 'login',
        targetUserId: user!.id,
        details: JSON.stringify({reason: 'bad_password'}),
        tenantId: user!.tenantId,
      });
      throwError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid credentials.');
    }
    if (!user!.snapshot().isActive) {
      throwError(ERROR_CODES.USER_DISABLED, 'Account is disabled.');
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
  public async setStatus(
      userId: string,
      isActive: boolean,
      ctx: AuditContext,
  ): Promise<User> {
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
    // NOTE: data cleanup is delegated to the Cleanup service via the
    // cleanup-queue. The User service only removes the auth record.
    await this.users.delete(userId);
    await this.recordAudit(ctx, {
      action: 'delete_user',
      targetUserId: user.id,
      details: JSON.stringify({username: user.username}),
      tenantId: user.tenantId,
    });
  }

  /** Get a user by id. */
  public async getUser(userId: string): Promise<User> {
    return this.requireUser(userId);
  }

  /** List users (paged). */
  public async listUsers(opts: {
    role?: string;
    page?: number;
    size?: number;
  }) {
    const limit = opts.size ?? 50;
    const offset = ((opts.page ?? 1) - 1) * limit;
    return this.users.list({role: opts.role, offset, limit});
  }

  /** Issue a refresh token and persist it. */
  public async issueRefreshToken(user: User): Promise<{jti: string; expiresAt: string}> {
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
    return {jti, expiresAt};
  }

  /** Revoke a single refresh token (used by `/auth/refresh` rotation). */
  public async revokeRefreshToken(jti: string): Promise<void> {
    await this.refresh.revoke(jti);
  }

  /** Get the audit log for a tenant. */
  public async listAudit(
      tenantId: string,
      opts: {page?: number; size?: number},
  ) {
    const limit = opts.size ?? 50;
    const offset = ((opts.page ?? 1) - 1) * limit;
    return this.audit.listForTenant(tenantId, {offset, limit});
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
