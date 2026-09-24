/**
 * @fileoverview Logout use case: revokes the refresh token's family.
 */

import {sha256Hex} from '@ontodecide/shared-kernel';
import type {IdentityDeps} from './deps';

/** Handles `logout`. Idempotent; unknown tokens are ignored. */
export class LogoutHandler {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(refreshToken: string): Promise<void> {
    if (typeof refreshToken !== 'string' || !refreshToken) return;
    const record = await this.deps.tokens.findByHash(
      await sha256Hex(refreshToken),
    );
    if (record) await this.deps.tokens.revokeFamily(record.family);
  }
}
