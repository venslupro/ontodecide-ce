/**
 * @fileoverview data-integration service module wired like the e2e
 * harness: rpcBinding fakes for ONTOLOGY / OBJECTS and a fake Workers AI.
 */

import {AppError, FixedClock} from '@ontodecide/shared-kernel';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {SituationRpc} from '@ontodecide/situation/contract';
import {
  createTestD1,
  FakeWorkersAi,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import {
  FakeObjectGraph,
  fakeOntology,
  fakeSituation,
} from '../../../packages/integration/interface/test_fixtures';
import type {Env} from './env';
import {configFrom} from './container';
import {createService} from './service';

function env(overrides: Partial<Env> = {}): Env & {graph: FakeObjectGraph} {
  const graph = new FakeObjectGraph();
  return {
    INTEGRATION_DB: createTestD1('data-integration'),
    ONTOLOGY: rpcBinding(fakeOntology() as OntologyRpc),
    OBJECTS: rpcBinding(graph as unknown as ObjectGraphRpc),
    SITUATION: rpcBinding(fakeSituation() as SituationRpc),
    graph,
    ...overrides,
  };
}

const clock = new FixedClock('2026-09-24T08:00:00Z');

describe('data-integration service', () => {
  it('reads limits from vars with design defaults', () => {
    expect(configFrom(env())).toMatchObject({
      importRowsDaily: 2000,
      seedRowsDaily: 20000,
      mappingAiDaily: 2,
      neuronsDailyBudget: 1500,
    });
    expect(
      configFrom(env({IMPORT_ROWS_DAILY: '100', MAPPING_AI_DAILY: 'x'})),
    ).toMatchObject({importRowsDaily: 100, mappingAiDaily: 2});
  });

  it('serves the RPC surface and the lifecycle', async () => {
    const e = env({IMPORT_ROWS_DAILY: '100'});
    const svc = createService(e, {clock});
    const ctx = testCtx();
    const sample = await svc.rpc.loadSample(ctx, 'supply-chain');
    expect(sample.status).toBe('DONE');
    expect(e.graph.links.get(ctx.tid)!.size).toBe(160);
    try {
      await svc.rpc.createImport(ctx, {
        fileName: 'a.csv',
        targetType: 'Supplier',
        totalRows: 101,
      });
      expect.unreachable();
    } catch (err) {
      expect(AppError.from(err).code).toBe('QUOTA_EXCEEDED');
    }
    expect(await svc.lifecycle!.countTenant(ctx.tid)).toBeGreaterThan(0);
  });

  it('uses the AI_MODEL binding when present and rules without it', async () => {
    const ai = new FakeWorkersAi().script('@cf/test/model', {
      response: {mappings: [{from: 'volume', to: 'capacity'}]},
    });
    const withAi = createService(
      env({AI: ai.asAi(), AI_MODEL: '@cf/test/model'}),
      {clock},
    );
    const without = createService(env(), {clock});
    const ctx = testCtx();
    const input = {
      fields: ['supplierId', 'name', 'volume'],
      sampleRows: [['S-1', 'A', '10']],
      targetType: 'Supplier',
    };
    for (const [svc, want] of [
      [withAi, 'ai'],
      [without, 'rules'],
    ] as const) {
      const job = await svc.rpc.createImport(ctx, {
        fileName: 'a.csv',
        targetType: 'Supplier',
        totalRows: 1,
      });
      expect((await svc.rpc.mappingDraft(ctx, job.id, input)).rankedBy).toBe(
        want,
      );
    }
    expect(ai.calls[0].model).toBe('@cf/test/model');
  });
});
