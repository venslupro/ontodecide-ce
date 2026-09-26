/**
 * @fileoverview Update a user's name, role or disabled flag (Admin).
 */

import {parseOrThrow, type CallCtx, type Role} from '@ontodecide/shared-kernel';
import {updateUserInputSchema, type UserDto} from '../contract';
import type {IdentityDeps} from './deps';
import {
  enforceAdminGuard,
  loadTenantUser,
  requireAdmin,
  toUserDto,
} from './support';

/** Handles `updateUser`. Disabling a user revokes their refresh tokens. */
export class UpdateUserHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(
    ctx: CallCtx,
    id: string,
    patch: {name?: string; role?: Role; disabled?: boolean},
  ): Promise<UserDto> {
    const c = requireAdmin(ctx);
    const p = parseOrThrow(updateUserInputSchema, patch ?? {});
    const {users, tokens, audit, clock} = this.deps;
    const user = await loadTenantUser(users, c, id);
    await enforceAdminGuard(users, c, user, {
      role: p.role,
      disabled: p.disabled,
    });
    const now = clock.now().getTime();
    if (p.name !== undefined) user.rename(p.name, now);

    let roleChange: {from: Role; to: Role} | undefined;
    if (p.role !== undefined && p.role !== user.role) {
      roleChange = {from: user.changeRole(p.role, now), to: p.role};
    }
    let disabledChange: boolean | undefined;
    if (p.disabled !== undefined && p.disabled !== user.disabled) {
      if (p.disabled) user.disable(now);
      else user.enable(now);
      disabledChange = p.disabled;
    }
    await users.save(user);

    if (roleChange) {
      await audit.record({
        tenantId: c.tenantId,
        actor: c.userId,
        event: 'user.role_changed',
        subject: user.id,
        detail: roleChange,
      });
    }
    if (disabledChange !== undefined) {
      if (disabledChange) await tokens.revokeAllForUser(c.tenantId, user.id);
      await audit.record({
        tenantId: c.tenantId,
        actor: c.userId,
        event: disabledChange ? 'user.disabled' : 'user.enabled',
        subject: user.id,
      });
    }
    return toUserDto(user);
  }
}
