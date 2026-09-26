/**
 * @fileoverview Change-own-password use case.
 */

import {AppError, parseOrThrow, type CallCtx} from '@ontodecide/shared-kernel';
import {changePasswordInputSchema} from '../contract';
import type {IdentityDeps} from './deps';
import {loadSelf, requireUserCtx} from './support';

/**
 * Handles `changePassword`. Clears `mustChangePassword` and revokes the
 * user's refresh families.
 */
export class ChangePasswordHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(
    ctx: CallCtx,
    input: {currentPassword: string; newPassword: string},
  ): Promise<void> {
    const c = requireUserCtx(ctx);
    const p = parseOrThrow(changePasswordInputSchema, input);
    const {users, hasher, tokens, audit, clock} = this.deps;
    const user = await loadSelf(users, c);
    const ok = await hasher.verify(p.currentPassword, {
      hash: user.pwdHash,
      salt: user.pwdSalt,
    });
    if (!ok) {
      throw new AppError('VALIDATION_FAILED', 'Current password is incorrect', {
        errors: [
          {path: 'currentPassword', message: 'Current password is incorrect'},
        ],
      });
    }
    if (p.newPassword === p.currentPassword) {
      throw new AppError('VALIDATION_FAILED', 'New password must differ', {
        errors: [{path: 'newPassword', message: 'New password must differ'}],
      });
    }
    const pwd = await hasher.hash(p.newPassword);
    user.setPassword(pwd.hash, pwd.salt, false, clock.now().getTime());
    await users.save(user);
    // The access JWT carries no refresh family, so every family is revoked;
    // the current session keeps working until its access token expires.
    await tokens.revokeAllForUser(user.tenantId, user.id);
    await audit.record({
      tenantId: user.tenantId,
      actor: user.id,
      event: 'user.password_changed',
      subject: user.id,
    });
  }
}
