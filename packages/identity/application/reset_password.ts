/**
 * @fileoverview Admin password reset (no email in the MVP).
 */

import {randomBytes, type CallCtx} from '@ontodecide/shared-kernel';
import {generateTemporaryPassword} from '../domain';
import type {IdentityDeps} from './deps';
import {loadTenantUser, requireAdmin} from './support';

/**
 * Handles `resetPassword`: sets a temporary password (returned once),
 * forces a change at next login, clears the lock and revokes all sessions.
 */
export class ResetPasswordHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(
    ctx: CallCtx,
    userId: string,
  ): Promise<{temporaryPassword: string}> {
    const c = requireAdmin(ctx);
    const {users, hasher, tokens, audit, clock} = this.deps;
    const user = await loadTenantUser(users, c, userId);
    const temporaryPassword = generateTemporaryPassword(randomBytes);
    const pwd = await hasher.hash(temporaryPassword);
    user.setPassword(pwd.hash, pwd.salt, true, clock.now().getTime());
    await users.save(user);
    await tokens.revokeAllForUser(c.tenantId, user.id);
    await audit.record({
      tenantId: c.tenantId,
      actor: c.userId,
      event: 'user.password_reset',
      subject: user.id,
    });
    return {temporaryPassword};
  }
}
