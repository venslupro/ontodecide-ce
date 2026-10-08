/**
 * @fileoverview D1 write-budget regression (详细设计 表 14 "CPU 与写入预算",
 * 修订说明书 12.4): loads the sample scenario through the real services and
 * the gateway and counts `meta.rows_written` as D1 bills it — the test D1
 * (packages/testing/d1_sqlite.ts) adds one row per index entry a write
 * touches. The design target is ≈ 1,100 rows; the test fails above
 * {@link SAMPLE_WRITE_BUDGET}. Re-importing unchanged data must write
 * (almost) nothing: unchanged objects are skipped by props_hash.
 */

import {describe, expect, it} from 'vitest';
import type {SqliteD1} from '../../packages/testing';
import {createSystem, signUp, type System} from '../e2e/harness';

/** Hard ceiling for one sample load (design target ≈ 1,100). */
const SAMPLE_WRITE_BUDGET = 1_300;

/** Ceiling for re-importing the unchanged scenario (job bookkeeping only). */
const REIMPORT_WRITE_BUDGET = 30;

/** Rows written so far in the business databases a sample load touches. */
function written(sys: System): Record<string, number> {
  return Object.fromEntries(
    Object.entries(sys.dbs).map(([k, db]) => [
      k,
      (db as unknown as SqliteD1).rowsWritten,
    ]),
  );
}

function delta(
  before: Record<string, number>,
  after: Record<string, number>,
): {total: number; byDb: Record<string, number>} {
  const byDb: Record<string, number> = {};
  let total = 0;
  for (const k of Object.keys(after)) {
    byDb[k] = after[k] - (before[k] ?? 0);
    total += byDb[k];
  }
  return {total, byDb};
}

describe('D1 write budget', () => {
  it('loads the sample scenario within the rows_written budget', async () => {
    const sys = await createSystem();
    const owner = await signUp(sys, 'budget@example.com');
    // Cockpit initialization is not part of the sample load.
    await sys.api('GET', '/situation/overview?range=24h', {
      token: owner.token,
    });

    const before = written(sys);
    const res = await sys.api('POST', '/workspace/sample-data', {
      token: owner.token,
      body: {scenarioId: 'supply-chain'},
    });
    expect(res.status).toBe(202);
    await sys.drain();
    const load = delta(before, written(sys));
    // Index amplification is modelled: 80 objects + 160 links alone cost
    // more than their 240 base rows.
    expect(load.byDb.objects).toBeGreaterThan(2 * 240);
    expect(
      load.total,
      `sample load wrote ${load.total} rows: ${JSON.stringify(load.byDb)}`,
    ).toBeLessThanOrEqual(SAMPLE_WRITE_BUDGET);

    // Re-import the unchanged scenario: clear the once-per-workspace marker
    // so the same mapping + upsertBatch path runs again.
    const integration = sys.dbs.integration as unknown as SqliteD1;
    integration.raw
      .prepare(
        "DELETE FROM int_usage WHERE day = 'once' AND scope = ? AND key = 'seed_loaded'",
      )
      .run(owner.tid);
    const again = written(sys);
    const re = await sys.api('POST', '/workspace/sample-data', {
      token: owner.token,
      body: {scenarioId: 'supply-chain'},
    });
    expect(re.status).toBe(202);
    await sys.drain();
    const reimport = delta(again, written(sys));
    expect(
      reimport.byDb.objects,
      `re-import wrote ${JSON.stringify(reimport.byDb)}`,
    ).toBe(0);
    expect(reimport.total).toBeLessThanOrEqual(REIMPORT_WRITE_BUDGET);
  });
});
