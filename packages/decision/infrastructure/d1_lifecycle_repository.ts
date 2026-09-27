/**
 * @fileoverview Cross-workspace access for TenantLifecycle (export, purge,
 * count). Constructed only by the lifecycle entry point.
 */

import {SystemRepository, writeTombstone} from '@ontodecide/shared-kernel/d1';
import type {ScenarioDto} from '../contract';
import type {RecRecord} from '../domain';
import {toRecord, type RecRow} from './d1_recommendation_repository';
import {toScenario} from './d1_scenario_repository';

/** Tables purged, in order. */
const TENANT_TABLES = ['dec_recommendation', 'dec_scenario'] as const;

/** `rec_ai` rows of the workspace: scope `{tid}:{sub}`. */
const USAGE_PREDICATE = "substr(scope, 1, length(?1) + 1) = ?1 || ':'";

/** Lifecycle repository over DECISION_DB. */
export class D1LifecycleRepository extends SystemRepository {
  async scenarios(tid: string): Promise<ScenarioDto[]> {
    const {results} = await this.sql(
      `SELECT id, name, perturbations, candidates, result, created_at
       FROM dec_scenario WHERE tenant_id = ?1 ORDER BY created_at, id`,
      tid,
    ).all<Parameters<typeof toScenario>[0]>();
    return results.map(toScenario);
  }

  async recommendations(tid: string): Promise<RecRecord[]> {
    const {results} = await this.sql(
      `SELECT * FROM dec_recommendation WHERE tenant_id = ?1
       ORDER BY created_at, id`,
      tid,
    ).all<RecRow>();
    return results.map(toRecord);
  }

  async count(tid: string): Promise<number> {
    const row = await this.sql(
      `SELECT
         (SELECT COUNT(*) FROM dec_recommendation WHERE tenant_id = ?1) +
         (SELECT COUNT(*) FROM dec_scenario WHERE tenant_id = ?1) +
         (SELECT COUNT(*) FROM dec_usage WHERE ${USAGE_PREDICATE}) AS n`,
      tid,
    ).first<{n: number}>();
    return row?.n ?? 0;
  }

  /** Deletes up to `maxRows` rows; returns the number deleted. */
  async purge(tid: string, maxRows: number): Promise<number> {
    let left = maxRows;
    let deleted = 0;
    for (const table of TENANT_TABLES) {
      if (left <= 0) break;
      const res = await this.sql(
        `DELETE FROM ${table} WHERE rowid IN
           (SELECT rowid FROM ${table} WHERE tenant_id = ?1 LIMIT ?2)`,
        tid,
        left,
      ).run();
      const n = res.meta.changes ?? 0;
      deleted += n;
      left -= n;
    }
    if (left > 0) {
      const res = await this.sql(
        `DELETE FROM dec_usage WHERE rowid IN
           (SELECT rowid FROM dec_usage WHERE ${USAGE_PREDICATE} LIMIT ?2)`,
        tid,
        left,
      ).run();
      deleted += res.meta.changes ?? 0;
    }
    return deleted;
  }

  /** Writes the local tombstone (idempotent). */
  async tombstone(tid: string, nowMs: number): Promise<void> {
    await writeTombstone(this.db, tid, nowMs).run();
  }
}
