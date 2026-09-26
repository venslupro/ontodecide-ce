/**
 * @fileoverview Smoke test of the data-integration service module: wiring,
 * queue consumption through `queue`, cron through `scheduled`, and the real
 * aws4fetch presigner.
 */

import {AppError, FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {IngestMsg, ObjectWriteMsg} from '@ontodecide/integration/contract';
import type {CompiledModel, OntologyRpc} from '@ontodecide/ontology/contract';
import {describe, expect, it} from 'vitest';
// apps do not depend on @ontodecide/testing; import the fakes by path.
import {
  createTestD1,
  FetchMock,
  QueueBus,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import type {Env} from './env';
import {createService} from './service';

function model(tenantId: string): CompiledModel {
  const props = [
    {
      apiName: 'productId',
      displayName: {},
      dataType: 'string' as const,
      required: true,
    },
    {
      apiName: 'name',
      displayName: {},
      dataType: 'string' as const,
      required: true,
    },
    {apiName: 'dailyDemand', displayName: {}, dataType: 'double' as const},
  ];
  return {
    tenantId,
    version: '1.0.0',
    hash: 'h',
    schemas: [{apiName: 'supplyChain', version: '1.0.0'}],
    objectTypes: {
      Product: {
        apiName: 'Product',
        displayName: {},
        primaryKey: 'productId',
        titleProperty: 'name',
        properties: props,
        schemaApi: 'supplyChain',
        propsByName: Object.fromEntries(props.map(p => [p.apiName, p])),
        indexedProps: [],
        sensitiveProps: [],
      },
    },
    linkTypes: {},
    actionTypes: {},
    functions: {},
    simulationKpis: [],
    indexPlan: [],
  };
}

function env(bus: QueueBus, extra: Partial<Env> = {}): Env {
  const ontology: Pick<OntologyRpc, 'getActiveModel'> = {
    getActiveModel: async (ctx: CallCtx) => model(ctx.tenantId),
  };
  return {
    INTEGRATION_DB: createTestD1('integration'),
    ONTOLOGY: rpcBinding(ontology) as OntologyRpc,
    INGEST_QUEUE: bus.sender<IngestMsg>('ingest'),
    OBJECT_WRITES_QUEUE: bus.sender<ObjectWriteMsg>('object-writes'),
    CONNECTOR_ENC_KEY: 'k',
    ...extra,
  };
}

describe('createService', () => {
  it('wires rpc, queue and scheduled handlers', async () => {
    const bus = new QueueBus();
    const clock = new FixedClock('2026-09-24T00:00:00Z');
    const fetchMock = new FetchMock();
    const svc = createService(env(bus), {
      clock,
      logger: silentLogger,
      fetch: fetchMock.fetch,
    });
    const ctx = testCtx();
    const src = await svc.rpc.createSource(ctx, {
      name: 'Products',
      kind: 'file',
      config: {},
      mapping: {
        targetType: 'Product',
        primaryKey: {from: 'productId'},
        fields: [
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'dailyDemand', from: 'dailyDemand', transform: 'toNumber'},
        ],
      },
    });
    const {jobId} = await svc.rpc.submitBatch(ctx, src.id, {
      seq: 0,
      last: true,
      records: [
        {productId: 'P-900', name: ' Edge Gateway X1 ', dailyDemand: '320'},
      ],
    });
    await bus.drain({ingest: {handler: b => svc.queue!(b)}});
    const [w] = bus.peek('object-writes') as ObjectWriteMsg[];
    expect(w.cmds[0]).toMatchObject({
      type: 'Product',
      primaryKey: 'P-900',
      props: {productId: 'P-900', name: 'Edge Gateway X1', dailyDemand: 320},
    });
    await svc.rpc.reportWriteResult(ctx, jobId, w.seq, w.last, {
      upserted: 1,
      merged: 0,
      skipped: 0,
      rejected: [],
    });
    expect((await svc.rpc.getJob(ctx, jobId)).status).toBe('Succeeded');
    await svc.scheduled!('*/15 * * * *', clock.now());
    expect(fetchMock.calls).toHaveLength(0);
    // Presign without B2 credentials returns an empty URL.
    expect((await svc.rpc.presignUpload(ctx, src.id, 'p.csv', 10)).url).toBe(
      '',
    );
    try {
      await svc.rpc.getSource(testCtx({tenantId: 't2'}), src.id);
      throw new Error('expected failure');
    } catch (e) {
      expect(AppError.from(e).code).toBe('SOURCE_NOT_FOUND');
    }
  });

  it('presigns B2 PUT URLs with aws4fetch (path style, 15 min)', async () => {
    const bus = new QueueBus();
    const clock = new FixedClock('2026-09-24T00:00:00Z');
    const svc = createService(
      env(bus, {
        B2_KEY_ID: 'kid',
        B2_APP_KEY: 'secret',
        B2_BUCKET: 'ontodecide-ce-raw-prod',
        B2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
        B2_REGION: 'us-west-004',
      }),
      {clock, logger: silentLogger},
    );
    const ctx = testCtx();
    const src = await svc.rpc.createSource(ctx, {
      name: 'Products',
      kind: 'file',
      config: {},
      mapping: {
        targetType: 'Product',
        primaryKey: {from: 'productId'},
        fields: [],
      },
    });
    const res = await svc.rpc.presignUpload(ctx, src.id, 'products.csv', 100);
    const url = new URL(res.url);
    expect(url.origin).toBe('https://s3.us-west-004.backblazeb2.com');
    expect(url.pathname).toBe(`/ontodecide-ce-raw-prod/${res.key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260924T000000Z');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'kid/20260924/us-west-004/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(res.expiresAt).toBe('2026-09-24T00:15:00.000Z');
  });
});
