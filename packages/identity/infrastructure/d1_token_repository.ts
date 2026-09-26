/**
 * @fileoverview D1 implementation of {@link TokenRepository} over
 * `idn_refresh_token`. Only SHA-256 hashes of tokens are stored.
 */

import type {TokenRepository} from '../application';
import type {RefreshTokenRecord} from '../domain';

interface TokenRow {
  token_hash: string;
  user_id: string;
  tenant_id: string;
  family: string;
  expires_at: number;
  revoked: number;
  rotated: number;
  created_at: number;
}

/** Refresh tokens in D1. */
export class D1TokenRepository implements TokenRepository {
  constructor(private readonly db: D1Database) {}

  async insert(r: RefreshTokenRecord): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO idn_refresh_token (token_hash, user_id, tenant_id, family, ' +
          'expires_at, revoked, rotated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        r.tokenHash,
        r.userId,
        r.tenantId,
        r.family,
        r.expiresAt,
        r.revoked ? 1 : 0,
        r.rotated ? 1 : 0,
        r.createdAt,
      )
      .run();
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.db
      .prepare(
        'SELECT token_hash, user_id, tenant_id, family, expires_at, revoked, ' +
          'rotated, created_at FROM idn_refresh_token WHERE token_hash = ?',
      )
      .bind(tokenHash)
      .first<TokenRow>();
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      tenantId: row.tenant_id,
      family: row.family,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      rotated: row.rotated === 1,
      createdAt: row.created_at,
    };
  }

  async markRotated(tokenHash: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        'UPDATE idn_refresh_token SET rotated = 1 ' +
          'WHERE token_hash = ? AND rotated = 0 AND revoked = 0',
      )
      .bind(tokenHash)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async revokeFamily(family: string): Promise<void> {
    await this.db
      .prepare('UPDATE idn_refresh_token SET revoked = 1 WHERE family = ?')
      .bind(family)
      .run();
  }

  async revokeAllForUser(tenantId: string, userId: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE idn_refresh_token SET revoked = 1 WHERE tenant_id = ? AND user_id = ?',
      )
      .bind(tenantId, userId)
      .run();
  }

  async deleteAllForUser(tenantId: string, userId: string): Promise<void> {
    await this.db
      .prepare(
        'DELETE FROM idn_refresh_token WHERE tenant_id = ? AND user_id = ?',
      )
      .bind(tenantId, userId)
      .run();
  }
}
