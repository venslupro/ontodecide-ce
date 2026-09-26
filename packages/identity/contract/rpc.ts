/**
 * @fileoverview RPC contract exposed by identity-access (IdentityRpc).
 * Only api-gateway calls it.
 */

import type {CallCtx, Role} from '@ontodecide/shared-kernel';
import type {TokenPair, UserDto} from './types';

/** Identity & access RPC surface. */
export interface IdentityRpc {
  /**
   * Password login. Throws AUTH_INVALID (401) or AUTH_LOCKED (423). On an
   * empty database the configured bootstrap admin is created on first login.
   */
  login(input: {email: string; password: string}): Promise<TokenPair>;
  /** Rotates the refresh token (family rotation; replay revokes family). */
  refresh(refreshToken: string): Promise<TokenPair>;
  logout(refreshToken: string): Promise<void>;
  me(ctx: CallCtx): Promise<UserDto>;
  updateMe(
    ctx: CallCtx,
    patch: {name?: string; locale?: string},
  ): Promise<UserDto>;
  changePassword(
    ctx: CallCtx,
    input: {currentPassword: string; newPassword: string},
  ): Promise<void>;
  listUsers(ctx: CallCtx): Promise<UserDto[]>;
  createUser(
    ctx: CallCtx,
    input: {
      email: string;
      name: string;
      role: Role;
      markings?: string[];
      password?: string;
    },
  ): Promise<{user: UserDto; temporaryPassword?: string}>;
  updateUser(
    ctx: CallCtx,
    id: string,
    patch: {name?: string; role?: Role; disabled?: boolean},
  ): Promise<UserDto>;
  grantMarking(
    ctx: CallCtx,
    userId: string,
    markings: string[],
  ): Promise<UserDto>;
  /** Admin password reset (no email in MVP); returns a temporary password. */
  resetPassword(
    ctx: CallCtx,
    userId: string,
  ): Promise<{temporaryPassword: string}>;
  deleteUser(ctx: CallCtx, userId: string): Promise<void>;
}
