/**
 * @fileoverview D1 repositories of ontology-manager-db: the workspace
 * copy-on-write schema (workspace-scoped), the shared template table and
 * the cross-workspace lifecycle store.
 */

import {parseJson} from '@ontodecide/shared-kernel';
import {
  SystemRepository,
  sweepTombstones,
  TenantRepository,
  writeTombstone,
} from '@ontodecide/shared-kernel/d1';
import type {
  LifecycleStore,
  SchemaHead,
  SchemaSnapshot,
  SchemaWrite,
  TemplateStore,
  WorkspaceSchemaStore,
} from '../application';
import type {CompiledSchema} from '../contract';
import {normalizeOntology, type Template} from '../domain';

interface SchemaRowRaw {
  tomb: number | null;
  template_id: string | null;
  template_version: string | null;
  definition: string | null;
  compiled: string | null;
  etag: number | null;
  updated_at: number | null;
}

const SNAPSHOT_SQL = `
  SELECT (SELECT 1 FROM tenant_tombstone WHERE tenant_id = ?1) AS tomb,
         s.template_id, s.template_version, s.definition, s.compiled,
         s.etag, s.updated_at
  FROM (SELECT 1) AS one
  LEFT JOIN ont_workspace_schema s ON s.tenant_id = ?1`;

function toSnapshot(raw: SchemaRowRaw | null): SchemaSnapshot {
  if (!raw) return {tombstoned: false, row: null};
  const tombstoned = raw.tomb !== null;
  if (raw.etag === null || raw.definition === null) {
    return {tombstoned, row: null};
  }
  return {
    tombstoned,
    row: {
      templateId: raw.template_id ?? '',
      templateVersion: raw.template_version ?? '',
      definition: normalizeOntology(parseJson(raw.definition, {})),
      compiled: parseJson<CompiledSchema | null>(raw.compiled, null),
      etag: raw.etag,
      updatedAt: raw.updated_at ?? 0,
    },
  };
}

/** `ont_workspace_schema` of one workspace. */
export class D1WorkspaceSchemaRepository
  extends TenantRepository
  implements WorkspaceSchemaStore
{
  async head(): Promise<SchemaHead> {
    const row = await this.stmt(
      `SELECT (SELECT 1 FROM tenant_tombstone WHERE tenant_id = ?1) AS tomb,
              (SELECT etag FROM ont_workspace_schema WHERE tenant_id = ?1)
                AS etag`,
    ).first<{tomb: number | null; etag: number | null}>();
    return {
      tombstoned: row?.tomb !== null && row?.tomb !== undefined,
      etag: row?.etag ?? null,
    };
  }

  async load(): Promise<SchemaSnapshot> {
    return toSnapshot(await this.stmt(SNAPSHOT_SQL).first<SchemaRowRaw>());
  }

  async insertCopy(w: SchemaWrite): Promise<boolean> {
    const res = await this.stmt(
      `INSERT INTO ont_workspace_schema
         (tenant_id, template_id, template_version, definition, compiled,
          etag, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6
       WHERE NOT EXISTS
         (SELECT 1 FROM tenant_tombstone WHERE tenant_id = ?1)
       ON CONFLICT (tenant_id) DO NOTHING`,
      w.templateId,
      w.templateVersion,
      JSON.stringify(w.definition),
      JSON.stringify(w.compiled),
      w.updatedAt,
    ).run();
    return res.meta.changes === 1;
  }

  async update(w: SchemaWrite, ifMatch: number): Promise<boolean> {
    const res = await this.stmt(
      `UPDATE ont_workspace_schema
       SET definition = ?2, compiled = ?3, updated_at = ?4, etag = etag + 1
       WHERE tenant_id = ?1 AND etag = ?5`,
      JSON.stringify(w.definition),
      JSON.stringify(w.compiled),
      w.updatedAt,
      ifMatch,
    ).run();
    return res.meta.changes === 1;
  }
}

/**
 * Shared read-only `ont_template` (no workspace data, hence no tenant_id):
 * seeded from code on first use.
 */
export class D1TemplateRepository
  extends SystemRepository
  implements TemplateStore
{
  async ensure(t: Template, compiled: CompiledSchema): Promise<void> {
    const exists = await this.sql(
      'SELECT 1 AS x FROM ont_template WHERE template_id = ?1 AND version = ?2',
      t.id,
      t.version,
    ).first();
    if (exists) return;
    await this.sql(
      `INSERT INTO ont_template
         (template_id, version, definition, compiled, kpi_seed,
          automation_seed)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (template_id, version) DO NOTHING`,
      t.id,
      t.version,
      JSON.stringify(t.definition),
      JSON.stringify(compiled),
      JSON.stringify(t.seeds.kpis),
      JSON.stringify(t.seeds.automations),
    ).run();
  }
}

/** Cross-workspace access for TenantLifecycle only. */
export class D1LifecycleRepository
  extends SystemRepository
  implements LifecycleStore
{
  async load(tid: string): Promise<SchemaSnapshot> {
    return toSnapshot(await this.sql(SNAPSHOT_SQL, tid).first<SchemaRowRaw>());
  }

  async count(tid: string): Promise<number> {
    const row = await this.sql(
      'SELECT COUNT(*) AS n FROM ont_workspace_schema WHERE tenant_id = ?1',
      tid,
    ).first<{n: number}>();
    return row?.n ?? 0;
  }

  async purge(tid: string, nowMs: number): Promise<number> {
    const [del] = await this.db.batch([
      this.sql('DELETE FROM ont_workspace_schema WHERE tenant_id = ?1', tid),
      writeTombstone(this.db, tid, nowMs),
    ]);
    await sweepTombstones(this.db, nowMs);
    return del.meta.changes;
  }
}
