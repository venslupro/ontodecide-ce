/**
 * @fileoverview TenantLifecycle of decision-engine (详细设计 6.11.5):
 * exports `decisions.json` (scenarios, recommendations with candidates,
 * AI rationale and decisions) as one page; purges dec_recommendation,
 * dec_scenario and the workspace's dec_usage rows (scope `{tid}:{sub}`),
 * then writes the local tombstone.
 */

import {
  LIFECYCLE,
  type Clock,
  type ExportPage,
  type PurgeResult,
  type TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {ScenarioDto} from '../contract';
import {toDto, type RecRecord} from '../domain';
import type {D1LifecycleRepository} from '../infrastructure';

/** The `decisions.json` document. */
export interface DecisionsExport {
  scenarios: ScenarioDto[];
  recommendations: ReturnType<typeof toDto>[];
  /** True when detail was dropped to respect the 900 KB page bound. */
  truncated: boolean;
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Serializes within the page bound: full detail first; then without the
 * per-object simulation detail; then dropping the oldest entries.
 */
export function exportText(
  scenarios: ScenarioDto[],
  recs: RecRecord[],
  maxBytes: number = LIFECYCLE.exportPageBytes,
): string {
  const full: DecisionsExport = {
    scenarios,
    recommendations: recs.map(toDto),
    truncated: false,
  };
  let text = JSON.stringify(full);
  if (bytes(text) <= maxBytes) return text;
  const lean: DecisionsExport = {
    scenarios: scenarios.map(s => ({
      ...s,
      result: {...s.result, affected: []},
    })),
    recommendations: recs.map(r => {
      const {simulation: _s, ...rest} = toDto(r);
      return rest;
    }),
    truncated: true,
  };
  text = JSON.stringify(lean);
  while (bytes(text) > maxBytes) {
    if (lean.scenarios.length >= lean.recommendations.length) {
      lean.scenarios.shift();
    } else {
      lean.recommendations.shift();
    }
    if (!lean.scenarios.length && !lean.recommendations.length) break;
    text = JSON.stringify(lean);
  }
  return text;
}

/** Builds the lifecycle entry point. */
export function createDecisionLifecycle(
  repo: D1LifecycleRepository,
  clock: Clock,
): TenantLifecycleRpc {
  return {
    async exportTenant(tid: string): Promise<ExportPage> {
      const [scenarios, recs] = await Promise.all([
        repo.scenarios(tid),
        repo.recommendations(tid),
      ]);
      return {
        file: 'decisions.json',
        text: exportText(scenarios, recs),
        nextCursor: null,
      };
    },
    async purgeTenant(tid: string, maxRows: number): Promise<PurgeResult> {
      const max = Math.min(
        Math.max(1, Math.floor(maxRows) || 1),
        LIFECYCLE.purgeBatchRows,
      );
      const deleted = await repo.purge(tid, max);
      const left = await repo.count(tid);
      if (left === 0) await repo.tombstone(tid, clock.now().getTime());
      return {deleted, done: left === 0};
    },
    countTenant: (tid: string) => repo.count(tid),
  };
}
