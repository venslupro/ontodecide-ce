/**
 * @fileoverview HS256 access token signer. The header carries the `kid` of
 * the first key in `JWT_SECRET`; api-gateway verifies with the same keys.
 */

import {signJwt, ulid, type JwtKey} from '@ontodecide/shared-kernel';
import type {TokenSigner} from '../application';
import {ACCESS_TOKEN_TTL_SEC, type JwtClaims} from '../contract';
import type {User} from '../domain';

/** Signs access JWTs (15 minutes). */
export class JwtTokenSigner implements TokenSigner {
  constructor(private readonly keys: JwtKey[]) {}

  async signAccessToken(user: User, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    const claims: JwtClaims = {
      sub: user.id,
      tid: user.tenantId,
      role: user.role,
      mk: user.markings,
      name: user.name,
      locale: user.locale,
      iat,
      exp: iat + ACCESS_TOKEN_TTL_SEC,
      jti: ulid(now.getTime()),
    };
    return signJwt({...claims}, this.keys);
  }
}
