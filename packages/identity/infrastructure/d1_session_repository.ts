/**
 * @fileoverview Identity: session and session_rotated repository.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import {parseJson, type AuthMethod} from '@ontodecide/shared-kernel';
import type {SessionRecord, SessionRepository} from '../application';

interface SessionRow {
  session_id: string;
  user_id: string;
  family_id: string;
  refresh_hash: string;
  amr: string;
  client: string | null;
  created_at: number;
  expires_at: number;
}

function toSession(r: SessionRow): SessionRecord {
  return {
    sessionId: r.session_id,
    userId: r.user_id,
    familyId: r.family_id,
    refreshHash: r.refresh_hash,
    amr: parseJson<AuthMethod[]>(r.amr, ['otp']),
    client: r.client,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

/** D1 sessions. */
export class D1SessionRepository
  extends SystemRepository
  implements SessionRepository
{
  async create(s: SessionRecord, maxSessions: number): Promise<void> {
    await this.db.batch([
      this.sql(
        `INSERT INTO session (session_id, user_id, family_id, refresh_hash, amr, client, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        s.sessionId,
        s.userId,
        s.familyId,
        s.refreshHash,
        JSON.stringify(s.amr),
        s.client,
        s.createdAt,
        s.expiresAt,
      ),
      this.sql(
        `DELETE FROM session WHERE user_id = ?1 AND session_id NOT IN (
           SELECT session_id FROM session WHERE user_id = ?1
           ORDER BY created_at DESC, session_id DESC LIMIT ?2)`,
        s.userId,
        maxSessions,
      ),
    ]);
  }

  private async one(sql: string, arg: string): Promise<SessionRecord | null> {
    const r = await this.sql(sql, arg).first<SessionRow>();
    return r ? toSession(r) : null;
  }

  findById(sessionId: string) {
    return this.one('SELECT * FROM session WHERE session_id = ?1', sessionId);
  }

  findByHash(refreshHash: string) {
    return this.one(
      'SELECT * FROM session WHERE refresh_hash = ?1',
      refreshHash,
    );
  }

  async findRotated(refreshHash: string): Promise<{familyId: string} | null> {
    const r = await this.sql(
      'SELECT family_id FROM session_rotated WHERE refresh_hash = ?1',
      refreshHash,
    ).first<{family_id: string}>();
    return r ? {familyId: r.family_id} : null;
  }

  async rotate(
    s: SessionRecord,
    newHash: string,
    newExpiresAt: number,
  ): Promise<boolean> {
    const [upd] = await this.db.batch([
      this.sql(
        `UPDATE session SET refresh_hash = ?3, expires_at = ?4
         WHERE session_id = ?1 AND refresh_hash = ?2`,
        s.sessionId,
        s.refreshHash,
        newHash,
        newExpiresAt,
      ),
      this.sql(
        `INSERT INTO session_rotated (refresh_hash, family_id, expires_at)
         SELECT ?1, ?2, ?3 WHERE changes() = 1
         ON CONFLICT (refresh_hash) DO NOTHING`,
        s.refreshHash,
        s.familyId,
        s.expiresAt,
      ),
    ]);
    return upd.meta.changes === 1;
  }

  async revokeFamily(familyId: string): Promise<number> {
    const r = await this.sql(
      'DELETE FROM session WHERE family_id = ?1',
      familyId,
    ).run();
    return r.meta.changes;
  }

  async delete(sessionId: string, userId: string): Promise<void> {
    await this.sql(
      'DELETE FROM session WHERE session_id = ?1 AND user_id = ?2',
      sessionId,
      userId,
    ).run();
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.sql(
      'DELETE FROM session WHERE user_id = ?1',
      userId,
    ).run();
    return r.meta.changes;
  }

  async countActive(userId: string, now: number): Promise<number> {
    const r = await this.sql(
      'SELECT COUNT(*) AS n FROM session WHERE user_id = ?1 AND expires_at > ?2',
      userId,
      now,
    ).first<{n: number}>();
    return r?.n ?? 0;
  }

  async hasActiveRecoverySession(
    userId: string,
    now: number,
  ): Promise<boolean> {
    const r = await this.sql(
      `SELECT 1 AS x FROM session WHERE user_id = ?1 AND expires_at > ?2
       AND amr LIKE '%"recovery"%' LIMIT 1`,
      userId,
      now,
    ).first();
    return r !== null;
  }

  async sweep(now: number): Promise<void> {
    await this.db.batch([
      this.sql('DELETE FROM session WHERE expires_at <= ?1', now),
      this.sql('DELETE FROM session_rotated WHERE expires_at <= ?1', now),
    ]);
  }
}
