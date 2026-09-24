/**
 * @fileoverview Tests for the OntologyRpc handler object: role checks and
 * AppError codes surviving the RPC boundary.
 */

import {AppError, FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import {createTestD1, MemoryKV, rpcBinding, testCtx} from '@ontodecide/testing';
import {beforeEach, describe, expect, it} from 'vitest';
import {createOntologyHandlers} from '../application';
import type {OntologyRpc} from '../contract';
import {D1SchemaRepository, TieredSchemaCache} from '../infrastructure';
import {createOntologyRpc} from './ontology_rpc';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    // Across rpcBinding only the message survives.
    expect(e instanceof AppError).toBe(false);
    return AppError.from(e).code;
  }
  throw new Error('Expected an error');
}

describe('createOntologyRpc', () => {
  let rpc: OntologyRpc;

  beforeEach(() => {
    const clock = new FixedClock();
    const impl = createOntologyRpc(
      createOntologyHandlers({
        repo: new D1SchemaRepository(createTestD1('ontology')),
        cache: new TieredSchemaCache(
          new MemoryKV().asKV(),
          clock,
          silentLogger,
        ),
        clock,
        logger: silentLogger,
      }),
    );
    rpc = rpcBinding(impl);
  });

  it('lets Viewers read and requires Modeler for writes', async () => {
    const viewer = testCtx({role: 'Viewer'});
    expect((await rpc.getActiveModel(viewer)).version).toBe('0');
    expect(await rpc.listPacks(viewer)).toHaveLength(1);
    expect(await codeOf(rpc.importPack(viewer, {packId: 'supply-chain'}))).toBe(
      'FORBIDDEN',
    );
    expect(
      await codeOf(
        rpc.importPack(testCtx({role: 'Operator'}), {packId: 'supply-chain'}),
      ),
    ).toBe('FORBIDDEN');
    expect(await codeOf(rpc.exportPack(viewer, 'supplyChain'))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(rpc.getActiveModel(testCtx({roles: []})))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(rpc.getActiveModel(testCtx({tenantId: ''})))).toBe(
      'AUTH_INVALID',
    );
  });

  it('preserves AppError codes and extras across the binding', async () => {
    const modeler = testCtx({role: 'Modeler'});
    expect(await codeOf(rpc.getSchema(modeler, 'ghost'))).toBe('NOT_FOUND');
    expect(await codeOf(rpc.getSchema(modeler, 'ghost', 'x.y'))).toBe(
      'VALIDATION_FAILED',
    );
    const {report} = await rpc.importPack(modeler, {packId: 'supply-chain'});
    expect(report.version).toBe('1.0.0');

    const pack = await rpc.exportPack(modeler, 'supplyChain');
    const def = pack.schema;
    def.objectTypes = def.objectTypes.filter(t => t.apiName !== 'Product');
    def.linkTypes = def.linkTypes.filter(l => l.apiName !== 'usedIn');
    def.actionTypes = def.actionTypes.filter(a => a.targetType !== 'Product');
    def.functions = def.functions.filter(f => f.objectType !== 'Product');
    def.simulationKpis = [];
    await rpc.saveDraft(modeler, 'supplyChain', def);
    try {
      await rpc.publish(modeler, 'supplyChain');
      throw new Error('Expected ONTOLOGY_BREAKING_CHANGE');
    } catch (e) {
      const err = AppError.from(e);
      expect(err.code).toBe('ONTOLOGY_BREAKING_CHANGE');
      expect(err.status).toBe(422);
      expect(err.extras.diff).toMatchObject({
        breaking: true,
        toVersion: '2.0.0',
      });
    }
    const ok = await rpc.publish(modeler, 'supplyChain', {
      confirmVersion: '2.0.0',
    });
    expect(ok.version).toBe('2.0.0');
    expect(
      await rpc.evaluateFunction(modeler, 'supplierRiskLevel', {riskScore: 45}),
    ).toBe('MEDIUM');
  });
});
