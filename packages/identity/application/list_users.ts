/**
 * @fileoverview List the users of the caller's tenant (Admin).
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {UserDto} from '../contract';
import type {IdentityDeps} from './deps';
import {requireAdmin, toUserDto} from './support';

/** Handles `listUsers`. */
export class ListUsersHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(ctx: CallCtx): Promise<UserDto[]> {
    const c = requireAdmin(ctx);
    return (await this.deps.users.listByTenant(c.tenantId)).map(toUserDto);
  }
}
