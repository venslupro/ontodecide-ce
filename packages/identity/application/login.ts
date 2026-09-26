/**
 * @fileoverview Login use case, including first-login bootstrap of the
 * initial tenant and admin.
 */

import {
  AppError,
  constantTimeEqual,
  parseOrThrow,
  ulid,
} from '@ontodecide/shared-kernel';
import {loginInputSchema, type TokenPair} from '../contract';
import {normalizeEmail, User} from '../domain';
import type {IdentityDeps} from './deps';
import {TokenIssuer} from './token_issuer';

/** Same message for unknown email, wrong password and disabled accounts. */
export const INVALID_CREDENTIALS = 'Invalid email or password';

/** Name given to the bootstrap admin. */
export const BOOTSTRAP_ADMIN_NAME = 'Administrator';

/** Handles `login`. */
export class LoginHandler {
  private readonly issuer: TokenIssuer;

  constructor(private readonly deps: IdentityDeps) {
    this.issuer = new TokenIssuer(deps.signer, deps.tokens);
  }

  async execute(input: {email: string; password: string}): Promise<TokenPair> {
    const {password, ...rest} = parseOrThrow(loginInputSchema, input);
    const email = normalizeEmail(rest.email);
    const {users, hasher, audit, clock} = this.deps;
    const now = clock.now();
    const nowMs = now.getTime();

    const user =
      (await users.findByEmail(email)) ??
      (await this.tryBootstrap(email, password, nowMs));
    if (!user) {
      // Spend comparable time to avoid a user-enumeration timing oracle.
      await hasher.hash(password);
      await audit.record({
        tenantId: null,
        actor: null,
        event: 'auth.login_failed',
        subject: email,
        detail: {reason: 'unknown_email'},
      });
      throw new AppError('AUTH_INVALID', INVALID_CREDENTIALS);
    }

    if (user.isLocked(nowMs)) {
      throw new AppError('AUTH_LOCKED', 'Account temporarily locked', {
        lockedUntil: new Date(user.lockedUntil!).toISOString(),
      });
    }

    const ok = await hasher.verify(password, {
      hash: user.pwdHash,
      salt: user.pwdSalt,
    });
    if (!ok) {
      const lockedNow = user.recordLoginFailure(nowMs);
      await users.save(user);
      await audit.record({
        tenantId: user.tenantId,
        actor: null,
        event: 'auth.login_failed',
        subject: user.id,
        detail: {reason: 'bad_password', failedAttempts: user.failedAttempts},
      });
      if (lockedNow) {
        await audit.record({
          tenantId: user.tenantId,
          actor: null,
          event: 'auth.locked',
          subject: user.id,
          detail: {lockedUntil: new Date(user.lockedUntil!).toISOString()},
        });
      }
      throw new AppError('AUTH_INVALID', INVALID_CREDENTIALS);
    }

    if (user.disabled) {
      await audit.record({
        tenantId: user.tenantId,
        actor: null,
        event: 'auth.login_failed',
        subject: user.id,
        detail: {reason: 'disabled'},
      });
      throw new AppError('AUTH_INVALID', INVALID_CREDENTIALS);
    }

    user.recordLoginSuccess(nowMs);
    await users.save(user);
    return this.issuer.issue(user, now);
  }

  /**
   * Creates the first tenant and admin when the database has no users and
   * the credentials match the configured bootstrap admin.
   */
  private async tryBootstrap(
    email: string,
    password: string,
    nowMs: number,
  ): Promise<User | null> {
    const cfg = this.deps.bootstrap;
    if (!cfg || !cfg.email || !cfg.password) return null;
    if (email !== normalizeEmail(cfg.email)) return null;
    if (!constantTimeEqual(password, cfg.password)) return null;
    const {users, hasher, audit, logger} = this.deps;
    if ((await users.countAll()) > 0) return null;

    const tenant = {id: ulid(nowMs), name: cfg.tenantName, createdAt: nowMs};
    const pwd = await hasher.hash(password);
    const admin = User.create({
      id: ulid(nowMs),
      tenantId: tenant.id,
      email,
      name: BOOTSTRAP_ADMIN_NAME,
      role: 'Admin',
      pwdHash: pwd.hash,
      pwdSalt: pwd.salt,
      mustChangePassword: false,
      now: nowMs,
    });
    if (!(await users.bootstrap(tenant, admin))) {
      // Lost a race with another bootstrap; log in normally.
      return users.findByEmail(email);
    }
    await audit.record({
      tenantId: tenant.id,
      actor: admin.id,
      event: 'auth.bootstrap',
      subject: admin.id,
      detail: {tenantName: tenant.name},
    });
    logger.info('identity.bootstrap', {tenantId: tenant.id, userId: admin.id});
    return admin;
  }
}
