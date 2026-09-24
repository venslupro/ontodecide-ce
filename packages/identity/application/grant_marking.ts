/**
 * @fileoverview Set a user's markings (Admin).
 */

import {parseOrThrow, type CallCtx} from '@ontodecide/shared-kernel';
import {grantMarkingInputSchema, type UserDto} from '../contract';
import type {IdentityDeps} from './deps';
import {loadTenantUser, requireAdmin, toUserDto} from './support';

/**
 * Handles `grantMarking`. The given list replaces the user's markings, so
 * the same call also revokes markings that are left out.
 */
export class GrantMarkingHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(
    ctx: CallCtx,
    userId: string,
    markings: string[],
  ): Promise<UserDto> {
    const c = requireAdmin(ctx);
    const p = parseOrThrow(grantMarkingInputSchema, {markings});
    const {users, audit, clock} = this.deps;
    const user = await loadTenantUser(users, c, userId);
    const from = user.setMarkings(p.markings, clock.now().getTime());
    await users.save(user);
    await audit.record({
      tenantId: c.tenantId,
      actor: c.userId,
      event: 'user.markings_changed',
      subject: user.id,
      detail: {from, to: user.markings},
    });
    return toUserDto(user);
  }
}
