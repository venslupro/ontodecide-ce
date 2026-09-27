/**
 * @fileoverview Tenancy: purge_ledger (archive saga progress) and
 * archive_index repositories.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import type {Ledger, LedgerMode, LedgerPhase} from '../domain';
import type {
  ArchiveIndexRecord,
  ArchiveIndexRepository,
  LedgerRepository,
} from '../application';

interface LedgerRow {
  tenant_id: string;
  phase: string;
  mode: string;
  object_key: string | null;
  export_svc: string | null;
  export_cursor: string | null;
  parts: number;
  size_bytes: number | null;
  sha256: string | null;
  purge_svc: string | null;
  locale: string | null;
  time_zone: string | null;
  expired_at: number;
  mailed: number | null;
  attempts: number;
  updated_at: number;
}

function toLedger(r: LedgerRow): Ledger {
  return {
    tenantId: r.tenant_id,
    phase: r.phase as LedgerPhase,
    mode: r.mode as LedgerMode,
    objectKey: r.object_key,
    exportSvc: r.export_svc,
    exportCursor: r.export_cursor,
    parts: r.parts,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    purgeSvc: r.purge_svc,
    locale: r.locale,
    timeZone: r.time_zone,
    expiredAt: r.expired_at,
    mailed: r.mailed,
    attempts: r.attempts,
    updatedAt: r.updated_at,
  };
}

/** Ledger fields → columns (patchable fields only). */
const COLUMNS: Record<string, string> = {
  phase: 'phase',
  mode: 'mode',
  objectKey: 'object_key',
  exportSvc: 'export_svc',
  exportCursor: 'export_cursor',
  parts: 'parts',
  sizeBytes: 'size_bytes',
  sha256: 'sha256',
  purgeSvc: 'purge_svc',
  locale: 'locale',
  timeZone: 'time_zone',
  mailed: 'mailed',
  attempts: 'attempts',
  updatedAt: 'updated_at',
};

/** D1 purge_ledger. */
export class D1LedgerRepository
  extends SystemRepository
  implements LedgerRepository
{
  async get(tenantId: string): Promise<Ledger | null> {
    const r = await this.sql(
      'SELECT * FROM purge_ledger WHERE tenant_id = ?1',
      tenantId,
    ).first<LedgerRow>();
    return r ? toLedger(r) : null;
  }

  async next(): Promise<Ledger | null> {
    const r = await this.sql(
      `SELECT * FROM purge_ledger WHERE phase <> 'account_deleted'
       ORDER BY updated_at, tenant_id LIMIT 1`,
    ).first<LedgerRow>();
    return r ? toLedger(r) : null;
  }

  async create(l: Ledger): Promise<boolean> {
    const r = await this.sql(
      `INSERT INTO purge_ledger (tenant_id, phase, mode, object_key, export_svc, export_cursor,
         parts, size_bytes, sha256, purge_svc, locale, time_zone, expired_at, mailed, attempts, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT (tenant_id) DO NOTHING`,
      l.tenantId,
      l.phase,
      l.mode,
      l.objectKey,
      l.exportSvc,
      l.exportCursor,
      l.parts,
      l.sizeBytes,
      l.sha256,
      l.purgeSvc,
      l.locale,
      l.timeZone,
      l.expiredAt,
      l.mailed,
      l.attempts,
      l.updatedAt,
    ).run();
    return r.meta.changes === 1;
  }

  async update(
    tenantId: string,
    expectedUpdatedAt: number,
    patch: Partial<Omit<Ledger, 'tenantId' | 'expiredAt'>> & {
      updatedAt: number;
    },
  ): Promise<boolean> {
    const sets: string[] = [];
    const args: unknown[] = [tenantId, expectedUpdatedAt];
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMNS[k];
      if (!col || v === undefined) continue;
      args.push(v);
      sets.push(`${col} = ?${args.length}`);
    }
    const r = await this.sql(
      `UPDATE purge_ledger SET ${sets.join(', ')}
       WHERE tenant_id = ?1 AND updated_at = ?2`,
      ...args,
    ).run();
    return r.meta.changes === 1;
  }

  async delete(tenantId: string): Promise<void> {
    await this.sql(
      'DELETE FROM purge_ledger WHERE tenant_id = ?1',
      tenantId,
    ).run();
  }
}

interface ArchiveRow {
  tenant_id: string;
  object_key: string;
  size_bytes: number;
  sha256: string;
  deletion_token_hash: string;
  created_at: number;
  expires_at: number;
}

function toArchive(r: ArchiveRow): ArchiveIndexRecord {
  return {
    tenantId: r.tenant_id,
    objectKey: r.object_key,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    deletionTokenHash: r.deletion_token_hash,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

/** D1 archive_index. */
export class D1ArchiveIndexRepository
  extends SystemRepository
  implements ArchiveIndexRepository
{
  async upsert(r: ArchiveIndexRecord): Promise<void> {
    await this.sql(
      `INSERT INTO archive_index (tenant_id, object_key, size_bytes, sha256, deletion_token_hash, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (tenant_id) DO UPDATE SET object_key = excluded.object_key,
         size_bytes = excluded.size_bytes, sha256 = excluded.sha256,
         deletion_token_hash = excluded.deletion_token_hash,
         created_at = excluded.created_at, expires_at = excluded.expires_at`,
      r.tenantId,
      r.objectKey,
      r.sizeBytes,
      r.sha256,
      r.deletionTokenHash,
      r.createdAt,
      r.expiresAt,
    ).run();
  }

  private async one(
    sql: string,
    arg: string,
  ): Promise<ArchiveIndexRecord | null> {
    const r = await this.sql(sql, arg).first<ArchiveRow>();
    return r ? toArchive(r) : null;
  }

  get(tenantId: string) {
    return this.one(
      'SELECT * FROM archive_index WHERE tenant_id = ?1',
      tenantId,
    );
  }

  findByTokenHash(hash: string) {
    return this.one(
      'SELECT * FROM archive_index WHERE deletion_token_hash = ?1',
      hash,
    );
  }

  async due(now: number, limit: number): Promise<ArchiveIndexRecord[]> {
    const {results} = await this.sql(
      'SELECT * FROM archive_index WHERE expires_at <= ?1 ORDER BY expires_at LIMIT ?2',
      now,
      limit,
    ).all<ArchiveRow>();
    return results.map(toArchive);
  }

  async list(
    cursor: string | null,
    limit: number,
  ): Promise<ArchiveIndexRecord[]> {
    const {results} = await this.sql(
      `SELECT * FROM archive_index WHERE (?1 IS NULL OR tenant_id < ?1)
       ORDER BY tenant_id DESC LIMIT ?2`,
      cursor,
      limit,
    ).all<ArchiveRow>();
    return results.map(toArchive);
  }

  async count(): Promise<number> {
    const r = await this.sql('SELECT COUNT(*) AS n FROM archive_index').first<{
      n: number;
    }>();
    return r?.n ?? 0;
  }

  async finalDelete(tenantId: string, now: number): Promise<void> {
    await this.db.batch([
      this.sql('DELETE FROM archive_index WHERE tenant_id = ?1', tenantId),
      this.sql('DELETE FROM purge_ledger WHERE tenant_id = ?1', tenantId),
      this.sql(
        `INSERT INTO tenant_tombstone (tenant_id, deleted_at) VALUES (?1, ?2)
         ON CONFLICT (tenant_id) DO UPDATE SET deleted_at = excluded.deleted_at`,
        tenantId,
        now,
      ),
    ]);
  }
}
