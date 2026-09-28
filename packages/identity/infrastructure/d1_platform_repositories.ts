/**
 * @fileoverview PlatformAdmin repositories: platform_setting (+ blocklists),
 * admin_audit (append-only hash chain), admin_pending_change, system_flag
 * bookkeeping and the read-only admin queries.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import {AppError} from '@ontodecide/shared-kernel';
import type {AuditRow} from '../domain';
import type {
  AdminListRow,
  AdminQueryRepository,
  AuditRepository,
  PendingChange,
  PendingChangeRepository,
  SettingsRepository,
  SettingsValues,
  SystemFlag,
  SystemFlagRepository,
} from '../application';
import {isUniqueViolation} from './d1_rows';

/** D1 platform settings and blocklists. */
export class D1SettingsRepository
  extends SystemRepository
  implements SettingsRepository
{
  async get(): Promise<SettingsValues> {
    const {results} = await this.sql(
      'SELECT key, value, updated_at FROM platform_setting',
    ).all<{key: string; value: number; updated_at: number}>();
    const v = Object.fromEntries(results.map(r => [r.key, r.value]));
    return {
      signupEnabled: (v['signup_enabled'] ?? 1) === 1,
      signupDailyLimit: v['signup_daily_limit'] ?? 20,
      activeWorkspaceLimit: v['active_workspace_limit'] ?? 60,
      version: Math.max(0, ...results.map(r => r.updated_at)),
    };
  }

  async patch(
    patch: Partial<Omit<SettingsValues, 'version'>>,
    ifMatch: number,
    newVersion: number,
  ): Promise<boolean> {
    const enabled =
      patch.signupEnabled === undefined ? null : patch.signupEnabled ? 1 : 0;
    try {
      const r = await this.sql(
        `UPDATE platform_setting SET
           value = CASE key
             WHEN 'signup_enabled' THEN COALESCE(?1, value)
             WHEN 'signup_daily_limit' THEN COALESCE(?2, value)
             WHEN 'active_workspace_limit' THEN COALESCE(?3, value)
           END,
           updated_at = ?5
         WHERE (SELECT MAX(updated_at) FROM platform_setting) = ?4`,
        enabled,
        patch.signupDailyLimit ?? null,
        patch.activeWorkspaceLimit ?? null,
        ifMatch,
        newVersion,
      ).run();
      return r.meta.changes > 0;
    } catch (e) {
      if (/CHECK constraint failed/i.test(String(e))) {
        throw new AppError('VALIDATION_FAILED', 'Setting out of range');
      }
      throw e;
    }
  }

  async blockedDomains(): Promise<string[]> {
    const {results} = await this.sql(
      'SELECT domain FROM blocked_domain ORDER BY domain',
    ).all<{domain: string}>();
    return results.map(r => r.domain);
  }

  async anyDomainBlocked(domains: string[]): Promise<boolean> {
    if (domains.length === 0) return false;
    const r = await this.sql(
      `SELECT 1 AS x FROM blocked_domain
       WHERE domain IN (SELECT value FROM json_each(?1)) LIMIT 1`,
      JSON.stringify(domains),
    ).first();
    return r !== null;
  }

  async replaceDomains(domains: string[], now: number): Promise<void> {
    await this.db.batch([
      this.sql('DELETE FROM blocked_domain'),
      this.sql(
        `INSERT INTO blocked_domain (domain, added_at)
         SELECT DISTINCT value, ?2 FROM json_each(?1) WHERE true
         ON CONFLICT (domain) DO NOTHING`,
        JSON.stringify(domains),
        now,
      ),
    ]);
  }

  async isEmailBlocked(emailHmac: string): Promise<boolean> {
    const r = await this.sql(
      'SELECT 1 AS x FROM blocked_email WHERE email_hmac = ?1',
      emailHmac,
    ).first();
    return r !== null;
  }

  async blockEmail(emailHmac: string, now: number): Promise<void> {
    await this.sql(
      `INSERT INTO blocked_email (email_hmac, added_at) VALUES (?1, ?2)
       ON CONFLICT (email_hmac) DO NOTHING`,
      emailHmac,
      now,
    ).run();
  }

  async unblockEmail(emailHmac: string): Promise<void> {
    await this.sql(
      'DELETE FROM blocked_email WHERE email_hmac = ?1',
      emailHmac,
    ).run();
  }
}

interface AuditDbRow {
  id: string;
  at: number;
  action: string;
  target_tenant_id: string | null;
  target_user_id: string | null;
  reason: string | null;
  idempotency_key: string | null;
  result: string | null;
  prev_hash: string;
  row_hash: string;
}

function toAudit(r: AuditDbRow): AuditRow {
  return {
    id: r.id,
    at: r.at,
    action: r.action,
    targetTenantId: r.target_tenant_id,
    targetUserId: r.target_user_id,
    reason: r.reason,
    idempotencyKey: r.idempotency_key,
    result: r.result,
    prevHash: r.prev_hash,
    rowHash: r.row_hash,
  };
}

const HEAD =
  'SELECT row_hash FROM admin_audit ORDER BY at DESC, id DESC LIMIT 1';

/** D1 admin_audit. */
export class D1AuditRepository
  extends SystemRepository
  implements AuditRepository
{
  async latest(): Promise<AuditRow | null> {
    const r = await this.sql(
      'SELECT * FROM admin_audit ORDER BY at DESC, id DESC LIMIT 1',
    ).first<AuditDbRow>();
    return r ? toAudit(r) : null;
  }

  async append(row: AuditRow): Promise<'ok' | 'stale' | 'duplicate'> {
    try {
      // Conditional on the chain head: a concurrent append makes this stale.
      const r = await this.sql(
        `INSERT INTO admin_audit (id, at, action, target_tenant_id, target_user_id, reason,
           idempotency_key, result, prev_hash, row_hash)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
         WHERE COALESCE((${HEAD}), ?11) = ?9`,
        row.id,
        row.at,
        row.action,
        row.targetTenantId,
        row.targetUserId,
        row.reason,
        row.idempotencyKey,
        row.result,
        row.prevHash,
        row.rowHash,
        '0'.repeat(64),
      ).run();
      return r.meta.changes === 1 ? 'ok' : 'stale';
    } catch (e) {
      if (isUniqueViolation(e)) return 'duplicate';
      throw e;
    }
  }

  async findByKey(idempotencyKey: string): Promise<AuditRow | null> {
    const r = await this.sql(
      'SELECT * FROM admin_audit WHERE idempotency_key = ?1',
      idempotencyKey,
    ).first<AuditDbRow>();
    return r ? toAudit(r) : null;
  }

  async page(
    cursor: {at: number; id: string} | null,
    limit: number,
  ): Promise<AuditRow[]> {
    const {results} = await this.sql(
      `SELECT * FROM admin_audit
       WHERE (?1 IS NULL OR at < ?1 OR (at = ?1 AND id < ?2))
       ORDER BY at DESC, id DESC LIMIT ?3`,
      cursor?.at ?? null,
      cursor?.id ?? '',
      limit,
    ).all<AuditDbRow>();
    return results.map(toAudit);
  }

  async all(): Promise<AuditRow[]> {
    const {results} = await this.sql(
      'SELECT * FROM admin_audit ORDER BY at, id',
    ).all<AuditDbRow>();
    return results.map(toAudit);
  }

  async hasSince(
    action: string,
    tenantId: string,
    since: number,
  ): Promise<boolean> {
    const r = await this.sql(
      `SELECT 1 AS x FROM admin_audit WHERE action = ?1 AND target_tenant_id = ?2
       AND at > ?3 LIMIT 1`,
      action,
      tenantId,
      since,
    ).first();
    return r !== null;
  }

  async sweep(before: number): Promise<void> {
    await this.sql('DELETE FROM admin_audit WHERE at < ?1', before).run();
  }
}

interface PendingRow {
  id: string;
  kind: string;
  payload: string | null;
  requested_at: number;
  effective_at: number;
  notified_at: number | null;
  applied_at: number | null;
}

function toPending(r: PendingRow): PendingChange {
  return {
    id: r.id,
    kind: r.kind as PendingChange['kind'],
    payload: r.payload,
    requestedAt: r.requested_at,
    effectiveAt: r.effective_at,
    notifiedAt: r.notified_at,
    appliedAt: r.applied_at,
  };
}

/** D1 admin_pending_change. */
export class D1PendingChangeRepository
  extends SystemRepository
  implements PendingChangeRepository
{
  async unnotified(): Promise<PendingChange[]> {
    const {results} = await this.sql(
      `SELECT * FROM admin_pending_change WHERE notified_at IS NULL AND applied_at IS NULL
       ORDER BY requested_at LIMIT 5`,
    ).all<PendingRow>();
    return results.map(toPending);
  }

  async markNotified(id: string, now: number): Promise<void> {
    await this.sql(
      'UPDATE admin_pending_change SET notified_at = ?2 WHERE id = ?1',
      id,
      now,
    ).run();
  }

  async dueForApply(now: number): Promise<PendingChange[]> {
    const {results} = await this.sql(
      `SELECT * FROM admin_pending_change WHERE applied_at IS NULL AND effective_at <= ?1
       ORDER BY effective_at LIMIT 5`,
      now,
    ).all<PendingRow>();
    return results.map(toPending);
  }

  async markApplied(id: string, now: number): Promise<boolean> {
    const r = await this.sql(
      `UPDATE admin_pending_change SET applied_at = ?2, payload = NULL
       WHERE id = ?1 AND applied_at IS NULL`,
      id,
      now,
    ).run();
    return r.meta.changes === 1;
  }
}

/** D1 read-only admin queries. */
export class D1AdminQueryRepository
  extends SystemRepository
  implements AdminQueryRepository
{
  async listUsers(
    status: string | null,
    cursor: string | null,
    limit: number,
    now: number,
  ): Promise<AdminListRow[]> {
    const {results} = await this.sql(
      `SELECT * FROM (
         SELECT w.tenant_id, u.user_id, u.email_enc, w.status, w.trial_expires_at,
                a.expires_at AS zip_expires_at,
                (SELECT COUNT(*) FROM session s WHERE s.user_id = u.user_id AND s.expires_at > ?4) AS sessions,
                u.banned_at
         FROM workspace w JOIN user_account u ON u.tenant_id = w.tenant_id
         LEFT JOIN archive_index a ON a.tenant_id = w.tenant_id
         WHERE w.kind = 'trial'
         UNION ALL
         SELECT a.tenant_id, NULL, NULL, 'ARCHIVE_ONLY', NULL, a.expires_at, 0, NULL
         FROM archive_index a
         WHERE NOT EXISTS (SELECT 1 FROM workspace w WHERE w.tenant_id = a.tenant_id)
       )
       WHERE (?1 IS NULL OR status = ?1) AND (?2 IS NULL OR tenant_id < ?2)
       ORDER BY tenant_id DESC LIMIT ?3`,
      status,
      cursor,
      limit,
      now,
    ).all<{
      tenant_id: string;
      user_id: string | null;
      email_enc: string | null;
      status: string;
      trial_expires_at: number | null;
      zip_expires_at: number | null;
      sessions: number;
      banned_at: number | null;
    }>();
    return results.map(r => ({
      tenantId: r.tenant_id,
      userId: r.user_id,
      emailEnc: r.email_enc,
      status: r.status,
      trialExpiresAt: r.trial_expires_at,
      zipExpiresAt: r.zip_expires_at,
      sessions: r.sessions,
      bannedAt: r.banned_at,
    }));
  }

  async recentAudit(limit: number): Promise<AuditRow[]> {
    const {results} = await this.sql(
      'SELECT * FROM admin_audit ORDER BY at DESC, id DESC LIMIT ?1',
      limit,
    ).all<AuditDbRow>();
    return results.map(toAudit);
  }
}

/** D1 system_flag (cron bookkeeping; no personal data). */
export class D1SystemFlagRepository
  extends SystemRepository
  implements SystemFlagRepository
{
  async setOnce(key: string, value: number, at: number): Promise<boolean> {
    const r = await this.sql(
      `INSERT INTO system_flag (key, value, at) VALUES (?1, ?2, ?3)
       ON CONFLICT (key) DO NOTHING`,
      key,
      value,
      at,
    ).run();
    return r.meta.changes === 1;
  }

  async get(key: string): Promise<SystemFlag | null> {
    const r = await this.sql(
      'SELECT value, at FROM system_flag WHERE key = ?1',
      key,
    ).first<{value: number; at: number}>();
    return r ? {value: r.value, at: r.at} : null;
  }

  async setValue(key: string, value: number): Promise<void> {
    await this.sql(
      'UPDATE system_flag SET value = ?2 WHERE key = ?1',
      key,
      value,
    ).run();
  }

  async clear(key: string): Promise<void> {
    await this.sql('DELETE FROM system_flag WHERE key = ?1', key).run();
  }

  async countPrefix(prefix: string, atOrBefore: number): Promise<number> {
    const r = await this.sql(
      `SELECT COUNT(*) AS n FROM system_flag
       WHERE substr(key, 1, length(?1)) = ?1 AND at <= ?2`,
      prefix,
      atOrBefore,
    ).first<{n: number}>();
    return r?.n ?? 0;
  }
}
