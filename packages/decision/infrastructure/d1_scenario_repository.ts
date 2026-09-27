/**
 * @fileoverview dec_scenario repository (workspace-scoped).
 */

import {parseJson} from '@ontodecide/shared-kernel';
import {TenantRepository} from '@ontodecide/shared-kernel/d1';
import type {ScenarioDto, ScenarioResult} from '../contract';
import type {ScenarioRepository} from '../application';

interface Row {
  id: string;
  name: string | null;
  perturbations: string;
  candidates: string | null;
  result: string | null;
  created_at: number;
}

/** D1 implementation of {@link ScenarioRepository}. */
export class D1ScenarioRepository
  extends TenantRepository
  implements ScenarioRepository
{
  async insert(s: ScenarioDto): Promise<void> {
    await this.stmt(
      `INSERT INTO dec_scenario
         (tenant_id, id, name, perturbations, candidates, result, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      s.id,
      s.name,
      JSON.stringify(s.perturbations),
      JSON.stringify(s.candidates),
      JSON.stringify(s.result),
      Date.parse(s.createdAt),
    ).run();
  }

  async get(id: string): Promise<ScenarioDto | null> {
    const row = await this.stmt(
      `SELECT id, name, perturbations, candidates, result, created_at
       FROM dec_scenario WHERE tenant_id = ?1 AND id = ?2`,
      id,
    ).first<Row>();
    return row ? toScenario(row) : null;
  }
}

/** Maps a dec_scenario row. */
export function toScenario(row: Row): ScenarioDto {
  return {
    id: row.id,
    name: row.name ?? '',
    perturbations: parseJson(row.perturbations, []),
    candidates: parseJson(row.candidates, []),
    result: parseJson(row.result, {} as ScenarioResult),
    createdAt: new Date(row.created_at).toISOString(),
  };
}
