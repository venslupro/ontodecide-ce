/**
 * @fileoverview "Me" use cases: read and update the caller's own profile.
 */

import {parseOrThrow, type CallCtx} from '@ontodecide/shared-kernel';
import {updateMeInputSchema, type UserDto} from '../contract';
import type {IdentityDeps} from './deps';
import {loadSelf, requireUserCtx, toUserDto} from './support';

/** Handles `me`. */
export class MeHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(ctx: CallCtx): Promise<UserDto> {
    return toUserDto(await loadSelf(this.deps.users, requireUserCtx(ctx)));
  }
}

/** Handles `updateMe` (name and locale only). */
export class UpdateMeHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(
    ctx: CallCtx,
    patch: {name?: string; locale?: string},
  ): Promise<UserDto> {
    const c = requireUserCtx(ctx);
    const p = parseOrThrow(updateMeInputSchema, patch ?? {});
    const user = await loadSelf(this.deps.users, c);
    const now = this.deps.clock.now().getTime();
    if (p.name !== undefined) user.rename(p.name, now);
    if (p.locale !== undefined) user.changeLocale(p.locale, now);
    await this.deps.users.save(user);
    return toUserDto(user);
  }
}
