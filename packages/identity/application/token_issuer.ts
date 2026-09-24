/**
 * @fileoverview Issues access + refresh token pairs. Refresh tokens are 32
 * random bytes; only their SHA-256 hash is stored.
 */

import {ACCESS_TOKEN_TTL_SEC, type TokenPair} from '../contract';
import {randomToken, sha256Hex, ulid} from '@ontodecide/shared-kernel';
import {newRefreshRecord, type User} from '../domain';
import type {TokenRepository, TokenSigner} from './ports';
import {toUserDto} from './support';

/** Creates token pairs for logins and refreshes. */
export class TokenIssuer {
  constructor(
    private readonly signer: TokenSigner,
    private readonly tokens: TokenRepository,
  ) {}

  /**
   * Issues a pair at `now`. Pass the existing family when rotating; omit it
   * to start a new family (login).
   */
  async issue(user: User, now: Date, family?: string): Promise<TokenPair> {
    const accessToken = await this.signer.signAccessToken(user, now);
    const refreshToken = randomToken(32);
    const record = newRefreshRecord({
      tokenHash: await sha256Hex(refreshToken),
      userId: user.id,
      tenantId: user.tenantId,
      family: family ?? ulid(now.getTime()),
      now: now.getTime(),
    });
    await this.tokens.insert(record);
    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      refreshToken,
      refreshExpiresAt: new Date(record.expiresAt).toISOString(),
      user: toUserDto(user),
    };
  }
}
