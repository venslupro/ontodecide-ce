/**
 * @fileoverview Identity: admin_passkey, admin_recovery_code,
 * webauthn_challenge and system_flag repository.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import {parseJson} from '@ontodecide/shared-kernel';
import type {
  ChallengePurpose,
  PasskeyRecord,
  PasskeyRepository,
} from '../application';
import {isUniqueViolation} from './d1_rows';

interface PasskeyRow {
  credential_id: string;
  user_id: string;
  public_key: string;
  sign_count: number;
  transports: string | null;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
}

function toPasskey(r: PasskeyRow): PasskeyRecord {
  return {
    credentialId: r.credential_id,
    userId: r.user_id,
    publicKey: r.public_key,
    signCount: r.sign_count,
    transports: parseJson<string[]>(r.transports, []),
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

/** D1 admin second factor storage. */
export class D1PasskeyRepository
  extends SystemRepository
  implements PasskeyRepository
{
  async list(userId: string): Promise<PasskeyRecord[]> {
    const {results} = await this.sql(
      'SELECT * FROM admin_passkey WHERE user_id = ?1 ORDER BY created_at',
      userId,
    ).all<PasskeyRow>();
    return results.map(toPasskey);
  }

  async count(userId: string): Promise<number> {
    const r = await this.sql(
      'SELECT COUNT(*) AS n FROM admin_passkey WHERE user_id = ?1',
      userId,
    ).first<{n: number}>();
    return r?.n ?? 0;
  }

  async find(credentialId: string): Promise<PasskeyRecord | null> {
    const r = await this.sql(
      'SELECT * FROM admin_passkey WHERE credential_id = ?1',
      credentialId,
    ).first<PasskeyRow>();
    return r ? toPasskey(r) : null;
  }

  async insert(p: PasskeyRecord): Promise<void> {
    await this.sql(
      `INSERT INTO admin_passkey (credential_id, user_id, public_key, sign_count, transports, label, created_at, last_used_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      p.credentialId,
      p.userId,
      p.publicKey,
      p.signCount,
      JSON.stringify(p.transports),
      p.label,
      p.createdAt,
      p.lastUsedAt,
    ).run();
  }

  async updateCounter(
    credentialId: string,
    expected: number,
    next: number,
    now: number,
  ): Promise<boolean> {
    const r = await this.sql(
      `UPDATE admin_passkey SET sign_count = ?3, last_used_at = ?4
       WHERE credential_id = ?1 AND sign_count = ?2`,
      credentialId,
      expected,
      next,
      now,
    ).run();
    return r.meta.changes === 1;
  }

  async deleteKeeping(
    credentialId: string,
    userId: string,
    keep: number,
  ): Promise<boolean> {
    const r = await this.sql(
      `DELETE FROM admin_passkey WHERE credential_id = ?1 AND user_id = ?2
       AND (SELECT COUNT(*) FROM admin_passkey WHERE user_id = ?2) > ?3`,
      credentialId,
      userId,
      keep,
    ).run();
    return r.meta.changes === 1;
  }

  async deleteAll(userId: string): Promise<void> {
    await this.sql(
      'DELETE FROM admin_passkey WHERE user_id = ?1',
      userId,
    ).run();
  }

  async putChallenge(
    challenge: string,
    userId: string,
    purpose: ChallengePurpose,
    expiresAt: number,
  ): Promise<void> {
    await this.sql(
      `INSERT INTO webauthn_challenge (challenge, user_id, purpose, expires_at)
       VALUES (?1, ?2, ?3, ?4)`,
      challenge,
      userId,
      purpose,
      expiresAt,
    ).run();
  }

  async consumeChallenge(
    challenge: string,
    userId: string,
    purpose: ChallengePurpose,
    now: number,
  ): Promise<boolean> {
    const r = await this.sql(
      `DELETE FROM webauthn_challenge WHERE challenge = ?1 AND user_id = ?2
       AND purpose = ?3 AND expires_at > ?4`,
      challenge,
      userId,
      purpose,
      now,
    ).run();
    return r.meta.changes === 1;
  }

  async recoveryStats(): Promise<{total: number; unused: number}> {
    const r = await this.sql(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END), 0) AS unused
       FROM admin_recovery_code`,
    ).first<{total: number; unused: number}>();
    return {total: r?.total ?? 0, unused: r?.unused ?? 0};
  }

  async replaceRecoveryCodes(hashes: string[]): Promise<void> {
    await this.db.batch([
      this.sql('DELETE FROM admin_recovery_code'),
      ...hashes.map(h =>
        this.sql('INSERT INTO admin_recovery_code (code_hash) VALUES (?1)', h),
      ),
    ]);
  }

  async useRecoveryCode(hash: string, now: number): Promise<boolean> {
    const r = await this.sql(
      'UPDATE admin_recovery_code SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL',
      hash,
      now,
    ).run();
    return r.meta.changes === 1;
  }

  async setFlagOnce(key: string, now: number): Promise<boolean> {
    try {
      await this.sql(
        'INSERT INTO system_flag (key, value, at) VALUES (?1, 1, ?2)',
        key,
        now,
      ).run();
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }

  async hasFlag(key: string): Promise<boolean> {
    const r = await this.sql(
      'SELECT 1 AS x FROM system_flag WHERE key = ?1',
      key,
    ).first();
    return r !== null;
  }

  async clearFlag(key: string): Promise<void> {
    await this.sql('DELETE FROM system_flag WHERE key = ?1', key).run();
  }

  async sweepChallenges(now: number): Promise<void> {
    await this.sql(
      'DELETE FROM webauthn_challenge WHERE expires_at <= ?1',
      now,
    ).run();
  }
}
