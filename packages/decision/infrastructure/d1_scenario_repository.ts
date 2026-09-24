/**
 * @fileoverview D1 repository for dec_scenario.
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {Perturbation, ScenarioResult} from '../contract';
import type {ScenarioRecord, ScenarioRepository} from '../application';

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  perturbations: string;
  result: string | null;
  created_by: string;
  created_at: number;
}

function toRecord(r: Row): ScenarioRecord {
  const result = parseJson<ScenarioResult | null>(r.result, null);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    perturbations: parseJson<Perturbation[]>(r.perturbations, []),
    ...(result ? {result} : {}),
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** dec_scenario repository. */
export class D1ScenarioRepository implements ScenarioRepository {
  constructor(private readonly db: D1Database) {}

  async insert(s: ScenarioRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO dec_scenario (id, tenant_id, name, perturbations, result, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        s.id,
        s.tenantId,
        s.name,
        JSON.stringify(s.perturbations),
        s.result ? JSON.stringify(s.result) : null,
        s.createdBy,
        new Date(s.createdAt).getTime(),
      )
      .run();
  }

  async get(tenantId: string, id: string): Promise<ScenarioRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM dec_scenario WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, id)
      .first<Row>();
    return row ? toRecord(row) : null;
  }

  async list(tenantId: string, limit: number): Promise<ScenarioRecord[]> {
    const {results} = await this.db
      .prepare(
        'SELECT * FROM dec_scenario WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      )
      .bind(tenantId, limit)
      .all<Row>();
    return results.map(toRecord);
  }

  async setResult(
    tenantId: string,
    id: string,
    result: ScenarioResult,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE dec_scenario SET result = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(JSON.stringify(result), tenantId, id)
      .run();
  }

  async setPerturbations(
    tenantId: string,
    id: string,
    perturbations: Perturbation[],
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE dec_scenario SET perturbations = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(JSON.stringify(perturbations), tenantId, id)
      .run();
  }
}
