/**
 * @fileoverview CPU budget regression (详细设计 表 14 "CPU 与写入预算"):
 * times the hot paths the free plan's 10 ms CPU limit must cover — one
 * 100-row upsertBatch through object-graph, a 300-node / 900-edge impact
 * propagation, one export page, packing ~2 MB into a ZIP with fflate STORE,
 * and an object detail read — as the median of several warm runs.
 *
 * Budgets are 8 ms (ZIP 10 ms) × `CPU_BUDGET_FACTOR` (default 3 on CI,
 * 2 locally). Time spent inside the test D1 (node:sqlite) is subtracted:
 * in production that is D1 query time, spent outside the Worker and not
 * billed as its CPU time. Node wall-clock time is only a proxy — the
 * authoritative numbers are workerd's CPU time (`wrangler dev` / Workers
 * Logs `cpuTime`), which this test does not replace. The factor absorbs
 * runner noise so that only order-of-magnitude regressions fail.
 */

import {performance} from 'node:perf_hooks';
import {zipSync, type Zippable} from 'fflate';
import {beforeAll, describe, expect, it} from 'vitest';
import {propagate} from '../../packages/decision/domain';
import type {GraphEdge, UpsertCmd} from '../../packages/object-graph/contract';
import type {Rid} from '../../packages/shared-kernel';
import {testCtx, type SqliteD1} from '../../packages/testing';
import {createSystem, signUp, type System} from '../e2e/harness';

const FACTOR = Number(
  process.env.CPU_BUDGET_FACTOR ?? (process.env.CI ? '3' : '2'),
);
const BUDGET_MS = 8 * FACTOR;
const ZIP_BUDGET_MS = 10 * FACTOR;
const WARMUP = 2;
const RUNS = 7;

/**
 * Median wall time (ms) of `RUNS` calls after `WARMUP` unmeasured ones,
 * minus the time spent inside the given test databases.
 */
async function medianMs(
  fn: (run: number) => unknown,
  dbs: readonly SqliteD1[] = [],
): Promise<number> {
  for (let i = 0; i < WARMUP; i++) await fn(i);
  const busy = () => dbs.reduce((n, d) => n + d.busyMs, 0);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const b0 = busy();
    const t0 = performance.now();
    await fn(WARMUP + i);
    times.push(performance.now() - t0 - (busy() - b0));
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  if (process.env.CPU_BUDGET_REPORT) {
    console.log(
      `${expect.getState().currentTestName}: median ${median.toFixed(2)} ms`,
    );
  }
  return median;
}

/** 100 Material rows (each linked to a sample product); `run` varies stock. */
function materials(run: number): UpsertCmd[] {
  return Array.from({length: 100}, (_, i) => ({
    type: 'Material',
    primaryKey: `MX-${String(i).padStart(3, '0')}`,
    props: {
      materialId: `MX-${String(i).padStart(3, '0')}`,
      name: `Budget material ${i}`,
      category: 'Electronics',
      safetyStock: 100,
      stock: 1_000 + run * 10 + i,
      unitCost: 3.5,
      leadTimeDays: 14,
    },
    row: i + 1,
    links: [
      {
        type: 'usedIn',
        toType: 'Product',
        toKey: `P-${String((i % 20) + 1).padStart(3, '0')}`,
      },
    ],
  }));
}

describe('CPU budget', () => {
  let sys: System;
  let tid: string;
  let rid: Rid;
  /** The databases object-graph reads and writes (itself and ontology). */
  let dbs: SqliteD1[];

  beforeAll(async () => {
    sys = await createSystem();
    const owner = await signUp(sys, 'cpu@example.com');
    tid = owner.tid;
    dbs = [sys.dbs.objects, sys.dbs.ontology] as unknown as SqliteD1[];
    const res = await sys.api('POST', '/workspace/sample-data', {
      token: owner.token,
    });
    expect(res.status).toBe(202);
    const list = await sys.api<{items: {rid: Rid}[]}>(
      'GET',
      '/objects?type=Supplier&limit=1',
      {token: owner.token},
    );
    rid = list.body.items[0].rid;
  });

  it(`upserts a 100-row batch within ${BUDGET_MS} ms`, async () => {
    const rpc = sys.services.objects.rpc;
    const ctx = testCtx({tid});
    const ms = await medianMs(async run => {
      const res = await rpc.upsertBatch(ctx, {
        jobId: `cpu-${run}`,
        seq: 0,
        cmds: materials(run),
      });
      expect(res.upserted).toBe(100);
      expect(res.rejected).toEqual([]);
    }, dbs);
    expect(ms).toBeLessThanOrEqual(BUDGET_MS);
  });

  it(`propagates over 300 nodes / 900 edges within ${BUDGET_MS} ms`, async () => {
    const schema = await sys.services.ontology.rpc.getCompiledSchema(
      testCtx({tid}),
    );
    // 30 suppliers → 120 materials → 150 products, 900 weighted edges.
    const s = (i: number) => `ri.Supplier.${i}` as Rid;
    const m = (i: number) => `ri.Material.${i}` as Rid;
    const p = (i: number) => `ri.Product.${i}` as Rid;
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 450; i++) {
      edges.push({
        type: 'supplies',
        src: s(i % 30),
        dst: m((i * 7) % 120),
        weight: 0.5,
      });
    }
    for (let i = 0; i < 450; i++) {
      edges.push({
        type: 'usedIn',
        src: m(i % 120),
        dst: p((i * 11) % 150),
        weight: 0.8,
      });
    }
    expect(edges).toHaveLength(900);
    const perturbations = Array.from({length: 30}, (_, i) => ({
      rid: s(i),
      property: 'capacity',
      change: -0.6,
    }));
    let reached = 0;
    const ms = await medianMs(() => {
      reached = propagate({edges}, schema.linkTypes, perturbations).hop.size;
    });
    expect(reached).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThanOrEqual(BUDGET_MS);
  });

  it(`exports one page within ${BUDGET_MS} ms`, async () => {
    const lc = sys.services.objects.lifecycle!;
    let bytes = 0;
    const ms = await medianMs(async () => {
      bytes = (await lc.exportTenant(tid, null)).text.length;
    }, dbs);
    expect(bytes).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(BUDGET_MS);
  });

  it(`packs ~2 MB into a STORE ZIP within ${ZIP_BUDGET_MS} ms`, async () => {
    const line = JSON.stringify({
      rid: 'ri.Material.01K6A000000000000000000000',
      type: 'Material',
      props: {name: 'Budget material', stock: 1234, unitCost: 3.5},
    });
    const text = `${line}\n`.repeat(Math.ceil((2 << 20) / (line.length + 1)));
    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {
      'objects.jsonl': enc.encode(text.slice(0, 1_200_000)),
      'links.jsonl': enc.encode(text.slice(0, 600_000)),
      'audit.jsonl': enc.encode(text.slice(0, 250_000)),
      'manifest.json': enc.encode('{"files":[]}'),
    };
    let size = 0;
    const ms = await medianMs(() => {
      const zippable: Zippable = {};
      for (const [k, v] of Object.entries(files)) zippable[k] = [v, {}];
      size = zipSync(zippable, {level: 0}).byteLength;
    });
    expect(size).toBeGreaterThan(2_000_000);
    expect(ms).toBeLessThanOrEqual(ZIP_BUDGET_MS);
  });

  it(`reads an object's detail within ${BUDGET_MS} ms`, async () => {
    const rpc = sys.services.objects.rpc;
    const ctx = testCtx({tid});
    const ms = await medianMs(async () => {
      expect(await rpc.getObject(ctx, rid)).not.toBeNull();
    }, dbs);
    expect(ms).toBeLessThanOrEqual(BUDGET_MS);
  });
});
