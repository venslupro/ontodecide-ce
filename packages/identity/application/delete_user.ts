/**
 * @fileoverview Delete a user of the caller's tenant (Admin).
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {IdentityDeps} from './deps';
import {enforceAdminGuard, loadTenantUser, requireAdmin} from './support';

/** Handles `deleteUser`. Also removes the user's refresh tokens. */
export class DeleteUserHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(ctx: CallCtx, userId: string): Promise<void> {
    const c = requireAdmin(ctx);
    const {users, tokens, audit} = this.deps;
    const user = await loadTenantUser(users, c, userId);
    await enforceAdminGuard(users, c, user, {delete: true});
    await tokens.deleteAllForUser(c.tenantId, user.id);
    await users.delete(c.tenantId, user.id);
    await audit.record({
      tenantId: c.tenantId,
      actor: c.userId,
      event: 'user.deleted',
      subject: user.id,
      detail: {role: user.role},
    });
  }
}
