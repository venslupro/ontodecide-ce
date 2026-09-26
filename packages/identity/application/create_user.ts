/**
 * @fileoverview Create a user in the caller's tenant (Admin).
 */

import {
  AppError,
  parseOrThrow,
  randomBytes,
  ulid,
  type CallCtx,
  type Role,
} from '@ontodecide/shared-kernel';
import {createUserInputSchema, type UserDto} from '../contract';
import {generateTemporaryPassword, normalizeEmail, User} from '../domain';
import type {IdentityDeps} from './deps';
import {requireAdmin, toUserDto} from './support';

/** Input of `createUser`. */
export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
  markings?: string[];
  password?: string;
}

/**
 * Handles `createUser`. Without a password a temporary one is generated,
 * returned once, and the user must change it at first login.
 */
export class CreateUserHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(
    ctx: CallCtx,
    input: CreateUserInput,
  ): Promise<{user: UserDto; temporaryPassword?: string}> {
    const c = requireAdmin(ctx);
    const p = parseOrThrow(createUserInputSchema, input);
    const {users, hasher, audit, clock} = this.deps;
    const email = normalizeEmail(p.email);
    if (await users.findByEmail(email)) {
      throw new AppError('CONFLICT', 'Email already in use');
    }
    const temporaryPassword =
      p.password === undefined
        ? generateTemporaryPassword(randomBytes)
        : undefined;
    const pwd = await hasher.hash(p.password ?? temporaryPassword!);
    const now = clock.now().getTime();
    const user = User.create({
      id: ulid(now),
      tenantId: c.tenantId,
      email,
      name: p.name,
      role: p.role,
      markings: p.markings,
      pwdHash: pwd.hash,
      pwdSalt: pwd.salt,
      mustChangePassword: temporaryPassword !== undefined,
      now,
    });
    await users.insert(user);
    await audit.record({
      tenantId: c.tenantId,
      actor: c.userId,
      event: 'user.created',
      subject: user.id,
      detail: {role: user.role, markings: user.markings},
    });
    return {
      user: toUserDto(user),
      ...(temporaryPassword !== undefined ? {temporaryPassword} : {}),
    };
  }
}
