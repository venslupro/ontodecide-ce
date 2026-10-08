/**
 * @fileoverview Wiring test of the ontology-manager service module.
 */

import {FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import {createTestD1, rpcBinding, TEST_TID, testCtx} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import type {Env} from './env';
import {createService} from './service';

describe('createService', () => {
  it('serves OntologyRpc and TenantLifecycle over fake bindings', async () => {
    const env: Env = {
      ONTOLOGY_DB: createTestD1('ontology-manager'),
      ENVIRONMENT: 'test',
      APP_VERSION: '2.4.0',
    };
    const svc = createService(env, {
      clock: new FixedClock(),
      logger: silentLogger,
    });
    expect(svc.queue).toBeUndefined();
    expect(svc.scheduled).toBeUndefined();
    const rpc = rpcBinding(svc.rpc);
    const lc = rpcBinding(svc.lifecycle);
    const ctx = testCtx();

    // Default is the blank template: no types, no index plan.
    const compiled = await rpc.getCompiledSchema(ctx);
    expect(compiled).toMatchObject({custom: false, etag: 0});
    expect(compiled.indexPlan).toEqual([]);

    // Load the supply-chain scenario so the workspace has a concrete ontology.
    await rpc.setTemplate(ctx, 'supply-chain');
    const sc = await rpc.getCompiledSchema(ctx);
    expect(sc.indexPlan.length).toBeGreaterThan(0);

    const supplier = (await rpc.getDefinition(ctx, 'object-types', 'Supplier'))
      .item;
    const {etag} = await rpc.putDefinition(
      ctx,
      'object-types',
      'Supplier',
      {...supplier, icon: 'truck'},
      1,
    );
    expect(etag).toBe(2);
    expect((await rpc.getOntology(ctx)).custom).toBe(true);
    expect(await lc.countTenant(TEST_TID)).toBe(1);
    expect(await lc.purgeTenant(TEST_TID, 500)).toEqual({
      deleted: 1,
      done: true,
    });
    expect(
      (await rpc.getTemplateSeeds('supply-chain')).kpis.length,
    ).toBeGreaterThan(0);
  });
});
