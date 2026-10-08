/**
 * @fileoverview RPC and TenantLifecycle behaviour over emulated service
 * bindings (structured clone, errors reduced to their message).
 */

import {AppError, FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import type {TenantLifecycleRpc} from '@ontodecide/shared-kernel';
import {createTestD1, rpcBinding, TEST_TID, testCtx} from '@ontodecide/testing';
import {beforeEach, describe, expect, it} from 'vitest';
import {createOntologyHandlers, createOntologyLifecycle} from '../application';
import type {ObjectTypeDef, OntologyRpc} from '../contract';
import {
  D1LifecycleRepository,
  D1TemplateRepository,
  D1WorkspaceSchemaRepository,
  MemoryCompiledCache,
} from '../infrastructure';
import {createOntologyRpc} from './ontology_rpc';
import {createTenantLifecycle} from './tenant_lifecycle';

const OTHER_TID = '01K6A000000000000000000T02';

const DEPOT: ObjectTypeDef = {
  apiName: 'Depot',
  displayName: 'Depot',
  primaryKey: 'depotId',
  titleProperty: 'depotId',
  properties: [{apiName: 'depotId', displayName: 'ID', dataType: 'string'}],
};

describe('OntologyRpc and TenantLifecycle', () => {
  let db: D1Database;
  let clock: FixedClock;
  let rpc: OntologyRpc;
  let lc: TenantLifecycleRpc;
  const ctx = testCtx();

  beforeEach(() => {
    db = createTestD1('ontology-manager');
    clock = new FixedClock('2026-09-24T00:00:00Z');
    const handlers = createOntologyHandlers({
      schemas: tid => new D1WorkspaceSchemaRepository(db, tid),
      templates: new D1TemplateRepository(db),
      cache: new MemoryCompiledCache(),
      clock,
      logger: silentLogger,
    });
    rpc = rpcBinding(createOntologyRpc(handlers, silentLogger));
    lc = rpcBinding(
      createTenantLifecycle(
        createOntologyLifecycle({store: new D1LifecycleRepository(db), clock}),
      ),
    );
  });

  it('keeps error codes and extras across the binding', async () => {
    await rpc.putDefinition(ctx, 'object-types', 'Depot', DEPOT, 0);
    const err = await rpc
      .putDefinition(ctx, 'object-types', 'Depot', DEPOT, 0)
      .then(() => null, AppError.from);
    expect(err?.code).toBe('PRECONDITION_FAILED');
    expect(err?.status).toBe(412);
    expect(err?.extras).toEqual({etag: 1});
  });

  it('exports only the template reference for an unmodified workspace', async () => {
    expect(await lc.countTenant(TEST_TID)).toBe(0);
    const page = await lc.exportTenant(TEST_TID, null);
    expect(page).toMatchObject({file: 'ontology.json', nextCursor: null});
    expect(JSON.parse(page.text)).toEqual({
      templateId: 'blank',
      templateVersion: '1.0.0',
    });
  });

  it('exports the custom definition once modified', async () => {
    await rpc.putDefinition(ctx, 'object-types', 'Depot', DEPOT, 0);
    expect(await lc.countTenant(TEST_TID)).toBe(1);
    const doc = JSON.parse((await lc.exportTenant(TEST_TID, null)).text);
    expect(doc).toMatchObject({
      templateId: 'blank',
      templateVersion: '1.0.0',
      etag: 1,
      updatedAt: '2026-09-24T00:00:00.000Z',
    });
    expect(
      doc.definition.objectTypes.map((t: {apiName: string}) => t.apiName),
    ).toEqual(['Depot']);
  });

  it('purges the copy, writes the tombstone and then reads as empty', async () => {
    await rpc.putDefinition(ctx, 'object-types', 'Depot', DEPOT, 0);
    await rpc.putDefinition(
      testCtx({tid: OTHER_TID}),
      'object-types',
      'Depot',
      DEPOT,
      0,
    );

    expect(await lc.purgeTenant(TEST_TID, 500)).toEqual({
      deleted: 1,
      done: true,
    });
    expect(await lc.countTenant(TEST_TID)).toBe(0);
    const tomb = await db
      .prepare('SELECT deleted_at FROM tenant_tombstone WHERE tenant_id = ?1')
      .bind(TEST_TID)
      .first('deleted_at');
    expect(tomb).toBe(clock.now().getTime());
    // Idempotent.
    expect(await lc.purgeTenant(TEST_TID, 500)).toEqual({
      deleted: 0,
      done: true,
    });

    // Late requests see an empty ontology; writes are refused.
    expect((await rpc.getCompiledSchema(ctx)).objectTypes).toEqual({});
    expect((await rpc.listDefinitions(ctx, 'object-types')).items).toEqual([]);
    const err = await rpc
      .putDefinition(ctx, 'object-types', 'Depot', DEPOT, 0)
      .then(() => null, AppError.from);
    expect(err?.code).toBe('NOT_FOUND');
    expect(await lc.countTenant(TEST_TID)).toBe(0);

    // Other workspaces are untouched.
    expect(await lc.countTenant(OTHER_TID)).toBe(1);
    expect(
      (await rpc.getCompiledSchema(testCtx({tid: OTHER_TID}))).objectTypes
        .Depot,
    ).toBeDefined();
  });

  it('sweeps tombstones older than 48 hours on purge', async () => {
    await lc.purgeTenant(TEST_TID, 500);
    clock.advance(49 * 3_600_000);
    await lc.purgeTenant(OTHER_TID, 500);
    const rows = (
      await db
        .prepare('SELECT tenant_id FROM tenant_tombstone')
        .all<{tenant_id: string}>()
    ).results;
    expect(rows).toEqual([{tenant_id: OTHER_TID}]);
  });

  it('validates lifecycle arguments', async () => {
    const err = await lc.countTenant('').then(() => null, AppError.from);
    expect(err?.code).toBe('VALIDATION_FAILED');
  });
});
