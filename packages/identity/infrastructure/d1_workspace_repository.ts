/**
 * @fileoverview Tenancy: workspace repository and the account deletion
 * batch of the archive saga. Lifecycle queries always include
 * `kind = 'trial'`, so the admin workspace is never selected.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import {LIFECYCLE, type WorkspaceStatus} from '@ontodecide/shared-kernel';
import type {WorkspaceRecord, WorkspaceRepository} from '../application';
import {toWorkspace, type WorkspaceRow} from './d1_rows';

/** D1 workspaces. */
export class D1WorkspaceRepository
  extends SystemRepository
  implements WorkspaceRepository
{
  async get(tenantId: string): Promise<WorkspaceRecord | null> {
    const r = await this.sql(
      'SELECT * FROM workspace WHERE tenant_id = ?1',
      tenantId,
    ).first<WorkspaceRow>();
    return r ? toWorkspace(r) : null;
  }

  async countTrials(statuses: WorkspaceStatus[]): Promise<number> {
    const r = await this.sql(
      `SELECT COUNT(*) AS n FROM workspace WHERE kind = 'trial'
       AND status IN (SELECT value FROM json_each(?1))`,
      JSON.stringify(statuses),
    ).first<{n: number}>();
    return r?.n ?? 0;
  }

  async endTrial(tenantId: string, now: number): Promise<boolean> {
    const r = await this.sql(
      `UPDATE workspace SET status = 'EXPIRED', trial_expires_at = ?2, expired_at = ?2
       WHERE tenant_id = ?1 AND kind = 'trial' AND status = 'ACTIVE'`,
      tenantId,
      now,
    ).run();
    return r.meta.changes === 1;
  }

  async setTrialExpiry(
    tenantId: string,
    at: number,
    _now: number,
  ): Promise<boolean> {
    const r = await this.sql(
      `UPDATE workspace SET trial_expires_at = ?2, status = 'ACTIVE', expired_at = NULL,
         delete_mode = NULL
       WHERE tenant_id = ?1 AND kind = 'trial' AND status IN ('ACTIVE', 'EXPIRED')
         AND NOT EXISTS (SELECT 1 FROM purge_ledger WHERE tenant_id = ?1)`,
      tenantId,
      at,
    ).run();
    return r.meta.changes === 1;
  }

  async setDeleteMode(
    tenantId: string,
    mode: 'archive' | 'no_archive',
  ): Promise<boolean> {
    const r = await this.sql(
      `UPDATE workspace SET delete_mode = ?2
       WHERE tenant_id = ?1 AND kind = 'trial' AND status IN ('ACTIVE', 'EXPIRED')
         AND NOT EXISTS (SELECT 1 FROM purge_ledger WHERE tenant_id = ?1)`,
      tenantId,
      mode,
    ).run();
    return r.meta.changes === 1;
  }

  async dueExpirations(now: number, limit: number): Promise<WorkspaceRecord[]> {
    const {results} = await this.sql(
      `SELECT * FROM workspace WHERE kind = 'trial' AND status = 'ACTIVE'
       AND trial_expires_at <= ?1 ORDER BY trial_expires_at LIMIT ?2`,
      now,
      limit,
    ).all<WorkspaceRow>();
    return results.map(toWorkspace);
  }

  async expire(tenantId: string, now: number): Promise<boolean> {
    const r = await this.sql(
      `UPDATE workspace SET status = 'EXPIRED', expired_at = ?2
       WHERE tenant_id = ?1 AND kind = 'trial' AND status = 'ACTIVE'
         AND trial_expires_at <= ?2`,
      tenantId,
      now,
    ).run();
    return r.meta.changes === 1;
  }

  async nextArchiveCandidate(
    expiredBefore: number,
  ): Promise<WorkspaceRecord | null> {
    const r = await this.sql(
      `SELECT * FROM workspace w WHERE kind = 'trial' AND status = 'EXPIRED'
       AND expired_at <= ?1
       AND NOT EXISTS (SELECT 1 FROM purge_ledger l WHERE l.tenant_id = w.tenant_id)
       ORDER BY expired_at LIMIT 1`,
      expiredBefore,
    ).first<WorkspaceRow>();
    return r ? toWorkspace(r) : null;
  }

  async markArchiving(tenantId: string): Promise<void> {
    await this.sql(
      `UPDATE workspace SET status = 'ARCHIVING'
       WHERE tenant_id = ?1 AND kind = 'trial' AND status = 'EXPIRED'`,
      tenantId,
    ).run();
  }

  async deleteAccount(tenantId: string, now: number): Promise<void> {
    const owner =
      "SELECT user_id FROM user_account WHERE tenant_id = ?1 AND role = 'owner'";
    const hmac =
      "SELECT email_hmac FROM user_account WHERE tenant_id = ?1 AND role = 'owner'";
    await this.db.batch([
      this.sql(`DELETE FROM session WHERE user_id IN (${owner})`, tenantId),
      this.sql(
        `DELETE FROM pending_code WHERE email_hmac IN (${hmac})`,
        tenantId,
      ),
      this.sql(`DELETE FROM otp_limit WHERE email_hmac IN (${hmac})`, tenantId),
      this.sql(
        "DELETE FROM user_account WHERE tenant_id = ?1 AND role = 'owner'",
        tenantId,
      ),
      this.sql(
        "DELETE FROM workspace WHERE tenant_id = ?1 AND kind = 'trial'",
        tenantId,
      ),
      this.sql(
        `INSERT INTO tenant_tombstone (tenant_id, deleted_at) VALUES (?1, ?2)
         ON CONFLICT (tenant_id) DO NOTHING`,
        tenantId,
        now,
      ),
    ]);
  }

  async sweepTombstones(now: number): Promise<void> {
    await this.sql(
      'DELETE FROM tenant_tombstone WHERE deleted_at < ?1',
      now - LIFECYCLE.tombstoneHours * 3_600_000,
    ).run();
  }
}
