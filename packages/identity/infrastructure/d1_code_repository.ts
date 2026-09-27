/**
 * @fileoverview Identity: pending_code and otp_limit repository.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import type {Locale} from '@ontodecide/shared-kernel';
import {OTP, type CodePurpose} from '../domain';
import type {CodeRepository, PendingCode} from '../application';

interface PendingRow {
  code_hmac: string;
  attempts: number;
  expires_at: number;
  email_enc: string | null;
  locale: string | null;
}

/** D1 code storage. */
export class D1CodeRepository
  extends SystemRepository
  implements CodeRepository
{
  async getPending(
    emailHmac: string,
    purpose: CodePurpose,
  ): Promise<PendingCode | null> {
    const r = await this.sql(
      'SELECT * FROM pending_code WHERE email_hmac = ?1 AND purpose = ?2',
      emailHmac,
      purpose,
    ).first<PendingRow>();
    if (!r) return null;
    return {
      codeHmac: r.code_hmac,
      attempts: r.attempts,
      expiresAt: r.expires_at,
      emailEnc: r.email_enc,
      locale: r.locale as Locale | null,
    };
  }

  async putPending(
    emailHmac: string,
    purpose: CodePurpose,
    c: Omit<PendingCode, 'attempts'>,
  ): Promise<void> {
    await this.sql(
      `INSERT INTO pending_code (email_hmac, purpose, email_enc, locale, code_hmac, attempts, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
       ON CONFLICT (email_hmac, purpose) DO UPDATE SET email_enc = excluded.email_enc,
         locale = excluded.locale, code_hmac = excluded.code_hmac, attempts = 0,
         expires_at = excluded.expires_at`,
      emailHmac,
      purpose,
      c.emailEnc,
      c.locale,
      c.codeHmac,
      c.expiresAt,
    ).run();
  }

  async bumpAttempts(emailHmac: string, purpose: CodePurpose): Promise<number> {
    const r = await this.sql(
      `UPDATE pending_code SET attempts = attempts + 1
       WHERE email_hmac = ?1 AND purpose = ?2 RETURNING attempts`,
      emailHmac,
      purpose,
    ).first<{attempts: number}>();
    return r?.attempts ?? OTP.maxAttemptsPerCode;
  }

  async deletePending(emailHmac: string, purpose: CodePurpose): Promise<void> {
    await this.sql(
      'DELETE FROM pending_code WHERE email_hmac = ?1 AND purpose = ?2',
      emailHmac,
      purpose,
    ).run();
  }

  async limits(emailHmac: string, day: string) {
    const r = await this.sql(
      `SELECT
         COALESCE(SUM(CASE WHEN day = ?2 THEN sends END), 0) AS sends,
         COALESCE(SUM(CASE WHEN day = ?2 THEN failures END), 0) AS failures,
         MAX(locked_until) AS locked_until
       FROM otp_limit WHERE email_hmac = ?1`,
      emailHmac,
      day,
    ).first<{sends: number; failures: number; locked_until: number | null}>();
    return {
      sends: r?.sends ?? 0,
      failures: r?.failures ?? 0,
      lockedUntil: r?.locked_until ?? null,
    };
  }

  private ensure(emailHmac: string, day: string) {
    return this.sql(
      'INSERT INTO otp_limit (email_hmac, day) VALUES (?1, ?2) ON CONFLICT DO NOTHING',
      emailHmac,
      day,
    );
  }

  async takeSend(
    emailHmac: string,
    day: string,
    max: number,
  ): Promise<boolean> {
    const [, take] = await this.db.batch([
      this.ensure(emailHmac, day),
      this.sql(
        `UPDATE otp_limit SET sends = sends + 1
         WHERE email_hmac = ?1 AND day = ?2 AND sends < ?3`,
        emailHmac,
        day,
        max,
      ),
    ]);
    return take.meta.changes === 1;
  }

  async recordFailure(emailHmac: string, day: string): Promise<number> {
    const [, r] = await this.db.batch([
      this.ensure(emailHmac, day),
      this.sql(
        `UPDATE otp_limit SET failures = failures + 1
         WHERE email_hmac = ?1 AND day = ?2 RETURNING failures`,
        emailHmac,
        day,
      ),
    ]);
    const rows = r.results as {failures: number}[];
    return rows[0]?.failures ?? 0;
  }

  async lock(emailHmac: string, day: string, until: number): Promise<void> {
    await this.sql(
      'UPDATE otp_limit SET locked_until = ?3 WHERE email_hmac = ?1 AND day = ?2',
      emailHmac,
      day,
      until,
    ).run();
  }

  async sweep(now: number, keepDaysFrom: string): Promise<void> {
    await this.db.batch([
      this.sql(
        'DELETE FROM pending_code WHERE expires_at < ?1',
        now - (OTP.retentionMs - OTP.ttlMs),
      ),
      this.sql(
        `DELETE FROM otp_limit WHERE day < ?1
         AND (locked_until IS NULL OR locked_until < ?2)`,
        keepDaysFrom,
        now,
      ),
    ]);
  }
}
