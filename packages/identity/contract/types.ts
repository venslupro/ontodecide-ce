/**
 * @fileoverview Identity DTOs and JWT claims (the contract between
 * identity-access, which signs, and api-gateway, which verifies).
 */

import type {Role} from '@ontodecide/shared-kernel';

/** A user as returned to callers (never contains secrets). */
export interface UserDto {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  markings: string[];
  disabled: boolean;
  locale: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

/** Access JWT claims. Header carries `kid`. */
export interface JwtClaims {
  sub: string;
  tid: string;
  role: Role;
  mk: string[];
  name?: string;
  locale?: string;
  iat: number;
  exp: number;
  jti: string;
}

/** Tokens issued by login / refresh. */
export interface TokenPair {
  accessToken: string;
  /** Seconds (900). */
  expiresIn: number;
  /** Opaque; the gateway puts it into an HttpOnly cookie. */
  refreshToken: string;
  refreshExpiresAt: string;
  user: UserDto;
}

/** Token lifetimes. */
export const ACCESS_TOKEN_TTL_SEC = 900;
export const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 3600;

/** Refresh cookie name and path (first-party, SameSite=Strict). */
export const REFRESH_COOKIE = 'od_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
