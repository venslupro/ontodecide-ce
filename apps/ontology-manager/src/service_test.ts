/**
 * @fileoverview Wiring test of the ontology-manager service module.
 */

import {FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import {createTestD1, MemoryKV, rpcBinding, testCtx} from '@ontodecide/testing';
import type {Env} from './env';
import {createService} from './service';

describe('createService', () => {
  it('serves the ontology RPC over fake bindings', async () => {
    const kv = new MemoryKV();
    const env: Env = {
      ONTOLOGY_DB: createTestD1('ontology'),
      SCHEMA_CACHE: kv.asKV(),
    };
    const svc = createService(env, {
      clock: new FixedClock(),
      logger: silentLogger,
    });
    const rpc = rpcBinding(svc.rpc);
    const ctx = testCtx();

    expect((await rpc.getActiveModel(ctx)).version).toBe('0');
    const {report} = await rpc.importPack(ctx, {packId: 'supply-chain'});
    expect(report).toMatchObject({apiName: 'supplyChain', version: '1.0.0'});
    expect(report.publishedAt).toBe('2026-09-24T00:00:00.000Z');
    expect((await rpc.getActiveModel(ctx)).version).toBe('supplyChain@1.0.0');
    expect(await rpc.listSchemas(ctx)).toEqual([
      expect.objectContaining({
        apiName: 'supplyChain',
        currentVersion: '1.0.0',
        hasDraft: false,
      }),
    ]);
    const compiled = await rpc.getCompiledSchema(ctx, 'supplyChain');
    expect(compiled.indexPlan.length).toBeGreaterThan(0);
    expect(kv.writes).toBe(2);
    expect(svc.queue).toBeUndefined();
  });
});
