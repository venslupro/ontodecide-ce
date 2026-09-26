/**
 * @fileoverview D1 implementation of {@link SchemaRepository} over
 * `ont_schema` and `ont_pack`. Drafts use version `draft`; the current
 * version is the highest-semver PUBLISHED row. Published rows are never
 * updated.
 */

import {AppError, parseJson} from '@ontodecide/shared-kernel';
import type {
  CompiledSchema,
  OntologyPack,
  SchemaDef,
  SchemaStatus,
} from '../contract';
import {
  DRAFT_VERSION,
  type PublishRecord,
  type SchemaRecord,
  type SchemaRepository,
  type SchemaVersionRow,
} from '../application';
import {maxSemver} from '../domain';

interface SchemaRow {
  api_name: string;
  version: string;
  status: SchemaStatus;
  definition: string;
  compiled: string | null;
  published_by: string | null;
  published_at: number | null;
  updated_at: number;
}

const COLUMNS =
  'api_name, version, status, definition, compiled, published_by, published_at, updated_at';

/** D1 has a 100 bound-parameter limit per statement. */
const KEYS_PER_QUERY = 40;

function toRecord(r: SchemaRow): SchemaRecord {
  return {
    apiName: r.api_name,
    version: r.version,
    status: r.status,
    definition: JSON.parse(r.definition) as SchemaDef,
    compiled: parseJson<CompiledSchema | null>(r.compiled, null),
    publishedBy: r.published_by,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
  };
}

/** Tenant-scoped pack id (ont_pack.id is a global primary key). */
function packKey(tenantId: string, id: string): string {
  return `${tenantId}/${id}`;
}

/** Schema repository backed by the ontology D1 database. */
export class D1SchemaRepository implements SchemaRepository {
  constructor(private readonly db: D1Database) {}

  async listVersions(tenantId: string): Promise<SchemaVersionRow[]> {
    const {results} = await this.db
      .prepare(
        "SELECT api_name, version, status FROM ont_schema WHERE tenant_id = ? AND status IN ('DRAFT', 'PUBLISHED')",
      )
      .bind(tenantId)
      .all<{api_name: string; version: string; status: SchemaStatus}>();
    return results.map(r => ({
      apiName: r.api_name,
      version: r.version,
      status: r.status,
    }));
  }

  async getMany(
    tenantId: string,
    keys: readonly {apiName: string; version: string}[],
  ): Promise<SchemaRecord[]> {
    const out: SchemaRecord[] = [];
    for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
      const chunk = keys.slice(i, i + KEYS_PER_QUERY);
      const where = chunk
        .map(() => '(api_name = ? AND version = ?)')
        .join(' OR ');
      const {results} = await this.db
        .prepare(
          `SELECT ${COLUMNS} FROM ont_schema WHERE tenant_id = ? AND (${where})`,
        )
        .bind(tenantId, ...chunk.flatMap(k => [k.apiName, k.version]))
        .all<SchemaRow>();
      out.push(...results.map(toRecord));
    }
    return out;
  }

  getDraft(tenantId: string, api: string): Promise<SchemaRecord | null> {
    return this.getRow(tenantId, api, DRAFT_VERSION, 'DRAFT');
  }

  async getCurrent(
    tenantId: string,
    api: string,
  ): Promise<SchemaRecord | null> {
    const {results} = await this.db
      .prepare(
        "SELECT version FROM ont_schema WHERE tenant_id = ? AND api_name = ? AND status = 'PUBLISHED'",
      )
      .bind(tenantId, api)
      .all<{version: string}>();
    const version = maxSemver(results.map(r => r.version));
    return version ? this.getRow(tenantId, api, version, 'PUBLISHED') : null;
  }

  getVersion(
    tenantId: string,
    api: string,
    version: string,
  ): Promise<SchemaRecord | null> {
    return this.getRow(tenantId, api, version, 'PUBLISHED');
  }

  async listCurrent(tenantId: string): Promise<SchemaRecord[]> {
    const rows = await this.listVersions(tenantId);
    const byApi = new Map<string, string[]>();
    for (const r of rows) {
      if (r.status !== 'PUBLISHED') continue;
      byApi.set(r.apiName, [...(byApi.get(r.apiName) ?? []), r.version]);
    }
    const keys = [...byApi].map(([apiName, versions]) => ({
      apiName,
      version: maxSemver(versions)!,
    }));
    return keys.length ? this.getMany(tenantId, keys) : [];
  }

  async saveDraft(
    tenantId: string,
    def: SchemaDef,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ont_schema (tenant_id, api_name, version, status, definition, updated_at)
         VALUES (?, ?, ?, 'DRAFT', ?, ?)
         ON CONFLICT (tenant_id, api_name, version)
         DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at`,
      )
      .bind(tenantId, def.apiName, DRAFT_VERSION, JSON.stringify(def), now)
      .run();
  }

  async publish(tenantId: string, r: PublishRecord): Promise<void> {
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO ont_schema (tenant_id, api_name, version, status, definition, compiled,
               published_by, published_at, updated_at)
             VALUES (?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?)`,
          )
          .bind(
            tenantId,
            r.apiName,
            r.version,
            JSON.stringify(r.definition),
            JSON.stringify(r.compiled),
            r.publishedBy,
            r.publishedAt,
            r.publishedAt,
          ),
        this.db
          .prepare(
            "DELETE FROM ont_schema WHERE tenant_id = ? AND api_name = ? AND version = ? AND status = 'DRAFT'",
          )
          .bind(tenantId, r.apiName, DRAFT_VERSION),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(msg)) {
        throw new AppError(
          'CONFLICT',
          `Schema ${r.apiName}@${r.version} already exists`,
        );
      }
      throw e;
    }
  }

  async listPacks(tenantId: string): Promise<OntologyPack[]> {
    const {results} = await this.db
      .prepare(
        'SELECT manifest FROM ont_pack WHERE tenant_id = ? ORDER BY created_at',
      )
      .bind(tenantId)
      .all<{manifest: string}>();
    return results.map(r => JSON.parse(r.manifest) as OntologyPack);
  }

  async getPack(tenantId: string, id: string): Promise<OntologyPack | null> {
    const {results} = await this.db
      .prepare('SELECT manifest FROM ont_pack WHERE id = ? AND tenant_id = ?')
      .bind(packKey(tenantId, id), tenantId)
      .all<{manifest: string}>();
    return results[0]
      ? (JSON.parse(results[0].manifest) as OntologyPack)
      : null;
  }

  async savePack(
    tenantId: string,
    pack: OntologyPack,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ont_pack (id, tenant_id, name, version, manifest, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, version = excluded.version,
           manifest = excluded.manifest`,
      )
      .bind(
        packKey(tenantId, pack.id),
        tenantId,
        JSON.stringify(pack.name),
        pack.version,
        JSON.stringify(pack),
        now,
      )
      .run();
  }

  private async getRow(
    tenantId: string,
    api: string,
    version: string,
    status: SchemaStatus,
  ): Promise<SchemaRecord | null> {
    const {results} = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM ont_schema
         WHERE tenant_id = ? AND api_name = ? AND version = ? AND status = ?`,
      )
      .bind(tenantId, api, version, status)
      .all<SchemaRow>();
    return results[0] ? toRecord(results[0]) : null;
  }
}
