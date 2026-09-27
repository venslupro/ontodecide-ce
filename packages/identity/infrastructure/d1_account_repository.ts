/**
 * @fileoverview Identity: user_account repository, including the atomic
 * sign-up batch (详细设计 6.11.6) and the bootstrap admin creation.
 *
 * identity-access owns global tables (accounts exist before any workspace
 * context), so its repositories extend SystemRepository; every statement
 * names its keys explicitly.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import type {Locale} from '@ontodecide/shared-kernel';
import type {
  AccountRecord,
  AccountRepository,
  SignupCommand,
  SignupOutcome,
} from '../application';
import {isUniqueViolation, toAccount, type AccountRow} from './d1_rows';

/** D1 user_account access. */
export class D1AccountRepository
  extends SystemRepository
  implements AccountRepository
{
  private async one(
    sql: string,
    ...args: unknown[]
  ): Promise<AccountRecord | null> {
    const r = await this.sql(sql, ...args).first<AccountRow>();
    return r ? toAccount(r) : null;
  }

  findById(userId: string) {
    return this.one('SELECT * FROM user_account WHERE user_id = ?1', userId);
  }

  findByEmailHmac(emailHmac: string) {
    return this.one(
      'SELECT * FROM user_account WHERE email_hmac = ?1',
      emailHmac,
    );
  }

  findByTenant(tenantId: string) {
    return this.one(
      'SELECT * FROM user_account WHERE tenant_id = ?1',
      tenantId,
    );
  }

  findAdmin() {
    return this.one("SELECT * FROM user_account WHERE role = 'admin'");
  }

  async updateProfile(
    userId: string,
    patch: {locale?: Locale; timeZone?: string},
  ): Promise<void> {
    await this.sql(
      `UPDATE user_account SET locale = COALESCE(?2, locale),
         time_zone = COALESCE(?3, time_zone) WHERE user_id = ?1`,
      userId,
      patch.locale ?? null,
      patch.timeZone ?? null,
    ).run();
  }

  async setBanned(userId: string, bannedAt: number | null): Promise<void> {
    await this.sql(
      "UPDATE user_account SET banned_at = ?2 WHERE user_id = ?1 AND role = 'owner'",
      userId,
      bannedAt,
    ).run();
  }

  async replaceEmail(
    userId: string,
    emailHmac: string,
    emailEnc: string,
  ): Promise<void> {
    await this.sql(
      'UPDATE user_account SET email_hmac = ?2, email_enc = ?3 WHERE user_id = ?1',
      userId,
      emailHmac,
      emailEnc,
    ).run();
  }

  async createAdmin(cmd: {
    userId: string;
    tenantId: string;
    emailHmac: string;
    emailEnc: string;
    now: number;
  }): Promise<boolean> {
    try {
      await this.db.batch([
        this.sql(
          `INSERT INTO workspace (tenant_id, kind, owner_user_id, status, created_at)
           VALUES (?1, 'admin', ?2, 'ACTIVE', ?3)`,
          cmd.tenantId,
          cmd.userId,
          cmd.now,
        ),
        this.sql(
          `INSERT INTO user_account (user_id, tenant_id, role, email_hmac, email_enc, verified_at)
           VALUES (?1, ?2, 'admin', ?3, ?4, ?5)`,
          cmd.userId,
          cmd.tenantId,
          cmd.emailHmac,
          cmd.emailEnc,
          cmd.now,
        ),
      ]);
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }

  async signup(c: SignupCommand): Promise<SignupOutcome> {
    try {
      const [, , occupy] = await this.db.batch([
        this.sql(
          `INSERT INTO usage_counter (day, key, value) VALUES (?1, 'signup', 0), (?1, ?2, 0)
           ON CONFLICT DO NOTHING`,
          c.day,
          c.ipKey,
        ),
        this.sql(
          `UPDATE usage_counter SET value = value + 1
           WHERE day = ?1 AND key = ?2 AND value < 2`,
          c.day,
          c.ipKey,
        ),
        this.sql(
          `UPDATE usage_counter SET value = value + 1
           WHERE day = ?1 AND key = 'signup' AND changes() = 1
             AND (SELECT value FROM platform_setting WHERE key = 'signup_enabled') = 1
             AND value < (SELECT value FROM platform_setting WHERE key = 'signup_daily_limit')
             AND (SELECT COUNT(*) FROM workspace WHERE kind = 'trial' AND status = 'ACTIVE')
                 < (SELECT value FROM platform_setting WHERE key = 'active_workspace_limit')
             AND (SELECT COUNT(*) FROM workspace WHERE kind = 'trial'
                  AND status IN ('EXPIRED', 'ARCHIVING')) < ?2
             AND NOT EXISTS (SELECT 1 FROM usage_counter
                  WHERE day = ?1 AND key = 'signup_closed' AND value = 1)`,
          c.day,
          c.purgeBacklogLimit,
        ),
        this.sql(
          `INSERT INTO workspace (tenant_id, kind, owner_user_id, status, trial_expires_at, created_at)
           SELECT ?1, 'trial', ?2, 'ACTIVE', ?3, ?4 WHERE changes() = 1`,
          c.tenantId,
          c.userId,
          c.trialExpiresAt,
          c.now,
        ),
        this.sql(
          `INSERT INTO user_account (user_id, tenant_id, role, email_hmac, email_enc, locale, verified_at)
           SELECT ?1, ?2, 'owner', ?3, ?4, ?5, ?6
           WHERE EXISTS (SELECT 1 FROM workspace WHERE tenant_id = ?2)`,
          c.userId,
          c.tenantId,
          c.emailHmac,
          c.emailEnc,
          c.locale,
          c.now,
        ),
        this.sql(
          "DELETE FROM pending_code WHERE email_hmac = ?1 AND purpose = 'signup'",
          c.emailHmac,
        ),
      ]);
      return occupy.meta.changes === 1 ? 'created' : 'closed';
    } catch (e) {
      if (isUniqueViolation(e)) return 'duplicate';
      throw e;
    }
  }

  async dueReminders(verifiedBefore: number, now: number, limit: number) {
    const {results} = await this.sql(
      `SELECT u.*, w.trial_expires_at AS trial_expires_at
       FROM user_account u JOIN workspace w ON w.tenant_id = u.tenant_id
       WHERE u.role = 'owner' AND w.kind = 'trial' AND w.status = 'ACTIVE'
         AND u.reminded_at IS NULL AND u.banned_at IS NULL
         AND u.verified_at <= ?1 AND w.trial_expires_at > ?2
       ORDER BY u.verified_at LIMIT ?3`,
      verifiedBefore,
      now,
      limit,
    ).all<AccountRow & {trial_expires_at: number}>();
    return results.map(r => ({
      ...toAccount(r),
      trialExpiresAt: r.trial_expires_at,
    }));
  }

  async claimReminder(userId: string, now: number): Promise<boolean> {
    const r = await this.sql(
      'UPDATE user_account SET reminded_at = ?2 WHERE user_id = ?1 AND reminded_at IS NULL',
      userId,
      now,
    ).run();
    return r.meta.changes === 1;
  }

  async releaseReminder(userId: string): Promise<void> {
    await this.sql(
      'UPDATE user_account SET reminded_at = NULL WHERE user_id = ?1',
      userId,
    ).run();
  }
}
