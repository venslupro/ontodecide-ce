/**
 * @fileoverview Refresh use case: family rotation with replay detection.
 */

import {AppError, sha256Hex} from '@ontodecide/shared-kernel';
import type {TokenPair} from '../contract';
import {decideRefresh} from '../domain';
import type {IdentityDeps} from './deps';
import {TokenIssuer} from './token_issuer';

const INVALID_REFRESH = 'Invalid refresh token';

/** Handles `refresh`. */
export class RefreshHandler {
  private readonly issuer: TokenIssuer;

  constructor(private readonly deps: IdentityDeps) {
    this.issuer = new TokenIssuer(deps.signer, deps.tokens);
  }

  async execute(refreshToken: string): Promise<TokenPair> {
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new AppError('AUTH_INVALID', INVALID_REFRESH);
    }
    const {tokens, users, clock} = this.deps;
    const now = clock.now();
    const record = await tokens.findByHash(await sha256Hex(refreshToken));
    if (!record) throw new AppError('AUTH_INVALID', INVALID_REFRESH);

    const decision = decideRefresh(record, now.getTime());
    if (decision.kind === 'revokeFamily') {
      await this.revokeForReplay(record.family, record.tenantId, record.userId);
      throw new AppError('AUTH_INVALID', INVALID_REFRESH);
    }
    if (decision.kind === 'reject') {
      throw new AppError('AUTH_INVALID', INVALID_REFRESH);
    }

    const user = await users.findById(record.tenantId, record.userId);
    if (!user || user.disabled) {
      await tokens.revokeFamily(record.family);
      throw new AppError('AUTH_INVALID', INVALID_REFRESH);
    }
    if (!(await tokens.markRotated(record.tokenHash))) {
      // A concurrent request rotated it first: treat as replay.
      await this.revokeForReplay(record.family, record.tenantId, record.userId);
      throw new AppError('AUTH_INVALID', INVALID_REFRESH);
    }
    return this.issuer.issue(user, now, record.family);
  }

  private async revokeForReplay(
    family: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await this.deps.tokens.revokeFamily(family);
    await this.deps.audit.record({
      tenantId,
      actor: null,
      event: 'auth.refresh_replay',
      subject: userId,
      detail: {family},
    });
  }
}
