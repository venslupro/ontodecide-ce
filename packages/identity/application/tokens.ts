/**
 * @fileoverview Ed25519-signed tokens issued by identity-access: access
 * tokens (claims per shared-kernel AccessClaims), the admin pre-auth token
 * (after the e-mail code) and the step-up proof (after a passkey user
 * verification). Pre-auth and step-up tokens carry `typ` and no `role`/`tid`,
 * so they can never pass the gateway's access-token checks.
 */

import {
  AppError,
  publicJwkOf,
  signJwt,
  verifyJwt,
  type AccessClaims,
  type Clock,
  type Ed25519Jwk,
} from '@ontodecide/shared-kernel';
import {TOKEN_TTL} from '../domain';

interface TypedClaims {
  typ: 'preauth' | 'stepup';
  sub: string;
  iat: number;
  exp: number;
}

/** Signs and verifies identity-access tokens. */
export class TokenService {
  private readonly publicKeys: Ed25519Jwk[];

  constructor(
    private readonly key: Ed25519Jwk,
    private readonly clock: Clock,
  ) {
    this.publicKeys = [publicJwkOf(key)];
  }

  private nowSec(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  /** Signs an access token (15 min). */
  async access(
    c: Omit<AccessClaims, 'iat' | 'exp'>,
  ): Promise<{token: string; expiresIn: number}> {
    const iat = this.nowSec();
    const claims: AccessClaims = {...c, iat, exp: iat + TOKEN_TTL.accessS};
    return {
      token: await signJwt(claims, this.key),
      expiresIn: TOKEN_TTL.accessS,
    };
  }

  /** Pre-auth token for the admin's passkey step (5 min). */
  preAuth(userId: string): Promise<string> {
    return this.typed('preauth', userId, TOKEN_TTL.preAuthS);
  }

  /** Step-up proof bound to the admin (5 min). */
  stepUp(userId: string): Promise<string> {
    return this.typed('stepup', userId, TOKEN_TTL.stepUpS);
  }

  private typed(
    typ: TypedClaims['typ'],
    sub: string,
    ttl: number,
  ): Promise<string> {
    const iat = this.nowSec();
    return signJwt(
      {typ, sub, iat, exp: iat + ttl} satisfies TypedClaims,
      this.key,
    );
  }

  /** Verifies a pre-auth token; UNAUTHENTICATED otherwise. Returns sub. */
  async verifyPreAuth(token: string): Promise<string> {
    const c = await this.verifyTyped(token, 'preauth', 'UNAUTHENTICATED');
    return c.sub;
  }

  /** Verifies a step-up token for `userId`; FORBIDDEN otherwise. */
  async verifyStepUp(token: string | undefined, userId: string): Promise<void> {
    if (!token) throw new AppError('FORBIDDEN', 'STEP_UP_REQUIRED');
    const c = await this.verifyTyped(token, 'stepup', 'FORBIDDEN');
    if (c.sub !== userId) throw new AppError('FORBIDDEN', 'STEP_UP_REQUIRED');
  }

  private async verifyTyped(
    token: string,
    typ: TypedClaims['typ'],
    code: 'UNAUTHENTICATED' | 'FORBIDDEN',
  ): Promise<TypedClaims> {
    let c: TypedClaims;
    try {
      c = await verifyJwt<TypedClaims>(token, this.publicKeys, this.nowSec());
    } catch {
      throw new AppError(
        code,
        typ === 'stepup' ? 'STEP_UP_REQUIRED' : 'PREAUTH_INVALID',
      );
    }
    if (c.typ !== typ || typeof c.sub !== 'string') {
      throw new AppError(
        code,
        typ === 'stepup' ? 'STEP_UP_REQUIRED' : 'PREAUTH_INVALID',
      );
    }
    return c;
  }
}
