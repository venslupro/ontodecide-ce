/**
 * @fileoverview TenantLifecycle of data-integration against the real
 * migrations: export, bounded purge with tombstone, count.
 */

import {FixedClock} from '@ontodecide/shared-kernel';
import {hasTombstone} from '@ontodecide/shared-kernel/d1';
import {createTestD1, rpcBinding, TEST_TID, testCtx} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import {createIntegrationLifecycle} from './tenant_lifecycle';
import {createIntegrationRpc} from './integration_rpc';
import {testDeps} from './test_fixtures';

const OTHER_TID = '01K6A000000000000000000T02';

async function seeded() {
  const db = createTestD1('data-integration');
  const deps = testDeps(db);
  const rpc = rpcBinding(createIntegrationRpc(deps));
  for (const tid of [TEST_TID, OTHER_TID]) {
    const ctx = testCtx({tid});
    await rpc.loadSample(ctx, 'supply-chain');
    const job = await rpc.createImport(ctx, {
      fileName: 'p.csv',
      targetType: 'Product',
      totalRows: 3,
      mapping: {
        targetType: 'Product',
        primaryKey: {from: 'id'},
        fields: [{to: 'name', from: 'name'}],
      },
    });
    await rpc.submitBatch(ctx, job.id, {
      seq: 0,
      last: true,
      rows: [
        {id: 'X1', name: 'x'},
        {id: '', name: 'secret-value'},
      ],
    });
  }
  const lc = rpcBinding(
    createIntegrationLifecycle(db, new FixedClock('2026-09-25T00:00:00Z')),
  );
  return {db, lc};
}

describe('TenantLifecycle', () => {
  it('exports jobs and mappings as imports.json without raw data', async () => {
    const {lc} = await seeded();
    const page = await lc.exportTenant(TEST_TID, null);
    expect(page.file).toBe('imports.json');
    expect(page.nextCursor).toBeNull();
    const doc = JSON.parse(page.text);
    expect(doc.jobs).toHaveLength(2);
    expect(doc.jobs.map((j: {kind: string}) => j.kind).sort()).toEqual([
      'file',
      'sample',
    ]);
    expect(doc.mappings).toHaveLength(1);
    expect(doc.mappings[0]).toMatchObject({id: 'Product', name: 'p.csv'});
    expect(page.text).not.toContain('secret-value');
    // Match the cell as a JSON string value: random ULIDs may contain "X1".
    expect(page.text).not.toContain('"X1"');
  });

  it('purges in bounded steps, then writes the tombstone', async () => {
    const {db, lc} = await seeded();
    const before = await lc.countTenant(TEST_TID);
    // jobs 2, batches 3 + 1, rejects 1, mapping 1, usage import_rows + seed_loaded.
    expect(before).toBe(10);
    let deleted = 0;
    let steps = 0;
    for (;;) {
      const r = await lc.purgeTenant(TEST_TID, 3);
      expect(r.deleted).toBeLessThanOrEqual(3);
      deleted += r.deleted;
      steps++;
      if (r.done) break;
      expect(await hasTombstone(db, TEST_TID)).toBe(false);
    }
    expect(deleted).toBe(before);
    expect(steps).toBeGreaterThanOrEqual(4);
    expect(await lc.countTenant(TEST_TID)).toBe(0);
    expect(await hasTombstone(db, TEST_TID)).toBe(true);
    // Other workspaces and service-wide budgets are untouched.
    expect(await lc.countTenant(OTHER_TID)).toBe(before);
    const star = await db
      .prepare("SELECT COUNT(*) AS n FROM int_usage WHERE scope = '*'")
      .first<number>('n');
    expect(star).toBe(1);
    expect(await lc.purgeTenant(TEST_TID, 500)).toEqual({
      deleted: 0,
      done: true,
    });
  });
});
