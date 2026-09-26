/**
 * @fileoverview Helpers shared by handlers: DTO mapping, authorization and
 * lookups.
 */

import type {UserDto} from '../contract';
import {AppError, hasRole, type CallCtx} from '@ontodecide/shared-kernel';
import {
  checkAdminChange,
  removesActiveAdmin,
  type AdminChange,
  type User,
} from '../domain';
import type {UserRepository} from './ports';

/** Maps a user to its public DTO (no secrets). */
export function toUserDto(user: User): UserDto {
  const s = user.state;
  return {
    id: s.id,
    tenantId: s.tenantId,
    email: s.email,
    name: s.name,
    role: s.role,
    markings: [...s.markings],
    disabled: s.disabled,
    locale: s.locale,
    mustChangePassword: s.mustChangePassword,
    createdAt: new Date(s.createdAt).toISOString(),
    ...(s.lastLoginAt !== null
      ? {lastLoginAt: new Date(s.lastLoginAt).toISOString()}
      : {}),
  };
}

/** Throws AUTH_INVALID unless the context identifies a user in a tenant. */
export function requireUserCtx(ctx: CallCtx | undefined): CallCtx {
  if (!ctx || !ctx.tenantId || !ctx.userId) {
    throw new AppError('AUTH_INVALID', 'Missing call context');
  }
  return ctx;
}

/** Defense in depth: re-checks the Admin role (the gateway checks first). */
export function requireAdmin(ctx: CallCtx | undefined): CallCtx {
  const c = requireUserCtx(ctx);
  if (!hasRole(c.roles ?? [], 'Admin')) {
    throw new AppError('FORBIDDEN', 'Admin role required');
  }
  return c;
}

/** Loads the caller's own user or throws AUTH_INVALID. */
export async function loadSelf(
  users: UserRepository,
  ctx: CallCtx,
): Promise<User> {
  const user = await users.findById(ctx.tenantId, ctx.userId);
  if (!user || user.disabled) {
    throw new AppError('AUTH_INVALID', 'User not found or disabled');
  }
  return user;
}

/** Loads a user of the caller's tenant or throws NOT_FOUND. */
export async function loadTenantUser(
  users: UserRepository,
  ctx: CallCtx,
  id: string,
): Promise<User> {
  const user =
    typeof id === 'string' && id
      ? await users.findById(ctx.tenantId, id)
      : null;
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  return user;
}

/**
 * Applies the admin guards (no self removal, keep one active Admin) to a
 * change of `target`, throwing FORBIDDEN / CONFLICT.
 */
export async function enforceAdminGuard(
  users: UserRepository,
  ctx: CallCtx,
  target: User,
  change: AdminChange,
): Promise<void> {
  const activeAdmins = removesActiveAdmin(target, change)
    ? await users.countActiveAdmins(ctx.tenantId)
    : Number.POSITIVE_INFINITY;
  const violation = checkAdminChange({
    actorId: ctx.userId,
    target,
    change,
    activeAdmins,
  });
  if (violation === 'SELF_CHANGE') {
    throw new AppError(
      'FORBIDDEN',
      'Admins cannot delete, demote or disable themselves',
    );
  }
  if (violation === 'LAST_ADMIN') {
    throw new AppError(
      'CONFLICT',
      'A tenant must keep at least one active Admin',
    );
  }
}
