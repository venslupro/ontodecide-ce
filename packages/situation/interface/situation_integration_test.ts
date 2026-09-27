/**
 * @fileoverview Interface tests: SituationRpc routing and validation over
 * room stubs (workspace isolation), the domain-events consumer (grouping,
 * dedupe, tombstone, retry with backoff), the stream fetch routing and the
 * TenantLifecycle entry point.
 */

import {beforeEach, describe, expect, it} from 'vitest';
import {
  AppError,
  type QueueBatch,
  type QueueMessage,
  backoffSeconds,
  silentLogger,
} from '@ontodecide/shared-kernel';
import {
  FakeDoNamespace,
  QueueBus,
  TEST_TID,
  testCtx,
} from '@ontodecide/testing';
import type {SituationRoomApi, SituationRoomCore} from '../application';
import {
  type TestRoom,
  event,
  makeRoom,
} from '../infrastructure/room_test_fixtures';
import {createStreamFetch} from './fetch';
import {createSituationLifecycle} from './lifecycle';
import {createDomainEventsConsumer} from './queue';
import {createSituationRpc} from './rpc';

const T2 = '01K6A000000000000000000T02';
const S1 = 'ri.Supplier.01K6A0000000000000000000S1';

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return AppError.from(e).code;
  }
}

describe('situation interface', () => {
  let rooms: Map<string, TestRoom>;
  let ns: FakeDoNamespace<SituationRoomCore>;
  const resolve = (tid: string): SituationRoomApi =>
    ns.get(ns.idFromName(tid)) as unknown as SituationRoomApi;

  beforeEach(() => {
    rooms = new Map();
    ns = new FakeDoNamespace(name => {
      const r = makeRoom();
      rooms.set(name, r);
      return r.core;
    });
  });
  const room = (tid: string): TestRoom => {
    ns.instance(tid);
    return rooms.get(tid)!;
  };

  describe('SituationRpc', () => {
    it('routes each call to the room of ctx.tid (isolation)', async () => {
      room(TEST_TID).objects.put(S1, {risk: 99});
      room(T2).objects.put(S1, {risk: 1});
      const rpc = createSituationRpc(resolve);
      const a = await rpc.overview(testCtx(), {range: '24h'});
      const b = await rpc.overview(testCtx({tid: T2}), {range: '7d'});
      expect(a.alerts).toHaveLength(1);
      expect(b.alerts).toHaveLength(0);
      const alertId = a.alerts[0].id;
      expect(
        await codeOf(rpc.acknowledgeAlert(testCtx({tid: T2}), alertId)),
      ).toBe('NOT_FOUND');
      expect((await rpc.acknowledgeAlert(testCtx(), alertId)).status).toBe(
        'ACKED',
      );
    });

    it('validates inputs before reaching the room', async () => {
      const rpc = createSituationRpc(resolve);
      const ctx = testCtx();
      expect(
        await codeOf(
          rpc.createAutomation(ctx, {
            name: 'x',
            trigger: 'schedule',
            objectType: 'Supplier',
            condition: {op: 'exists', prop: 'risk'},
            severity: 'LOW',
            cooldownSec: 0,
            enabled: true,
          }),
        ),
      ).toBe('VALIDATION_FAILED');
      expect(
        await codeOf(rpc.listAlerts(ctx, {status: 'NOPE' as never}, {})),
      ).toBe('VALIDATION_FAILED');
      expect(await codeOf(rpc.deleteAutomation(ctx, 'auto-high-risk', 0))).toBe(
        'PRECONDITION_FAILED',
      );
      expect(ns.instances.size).toBe(0);
    });

    it('applies schema defaults (cooldown 3600, enabled)', async () => {
      const rpc = createSituationRpc(resolve);
      const created = await rpc.createAutomation(testCtx(), {
        name: 'x',
        trigger: 'threshold',
        objectType: 'Supplier',
        condition: {op: 'exists', prop: 'risk'},
        severity: 'LOW',
      } as never);
      expect(created).toMatchObject({
        cooldownSec: 3600,
        enabled: true,
        version: 1,
      });
      const got = await rpc.getAutomation(testCtx(), created.id);
      expect(got.id).toBe(created.id);
    });
  });

  describe('domain-events consumer', () => {
    it('groups by workspace, dedupes and acks', async () => {
      const a = room(TEST_TID);
      const b = room(T2);
      a.objects.put(S1, {risk: 90});
      b.objects.put(S1, {risk: 90});
      const bus = new QueueBus();
      const q = bus.sender('domain-events');
      const e1 = event([[S1, ['risk']]]);
      await q.send(e1);
      await q.send(e1);
      await q.send(event([[S1, ['risk']]], {tid: T2}));
      await q.send({junk: true});
      const handler = createDomainEventsConsumer({
        rooms: resolve,
        logger: silentLogger,
      });
      await bus.drain({
        'domain-events': {handler, deadLetterQueue: 'dead-letter'},
      });
      expect(bus.size('domain-events')).toBe(0);
      expect(bus.size('dead-letter')).toBe(0);
      const ctxA = testCtx();
      const ctxB = testCtx({tid: T2});
      expect((await a.core.listAlerts(ctxA, {}, {})).items).toHaveLength(1);
      expect((await b.core.listAlerts(ctxB, {}, {})).items).toHaveLength(1);
    });

    it('acks and drops events of a tombstoned workspace', async () => {
      const a = room(TEST_TID);
      a.objects.put(S1, {risk: 90});
      await a.core.overview(testCtx(), {range: '24h'});
      await a.core.purgeTenant(TEST_TID);
      const bus = new QueueBus();
      await bus.sender('domain-events').send(event([[S1, ['risk']]]));
      const handler = createDomainEventsConsumer({
        rooms: resolve,
        logger: silentLogger,
      });
      await bus.drain({
        'domain-events': {handler, deadLetterQueue: 'dead-letter'},
      });
      expect(bus.size('dead-letter')).toBe(0);
      expect(a.objects.calls.getObjects).toBe(0);
    });

    it('retries transient failures with backoff and acks permanent ones', async () => {
      const outcomes: string[] = [];
      const msg = (body: unknown, attempts: number): QueueMessage<unknown> => ({
        id: `m${attempts}`,
        body,
        attempts,
        ack: () => outcomes.push('ack'),
        retry: o => outcomes.push(`retry:${o?.delaySeconds}`),
      });
      const batch = (m: QueueMessage<unknown>[]): QueueBatch<unknown> => ({
        queue: 'ontodecide-prd-domain-events',
        messages: m,
        ackAll: () => {},
        retryAll: () => {},
      });
      const failing = (code: 'UNAVAILABLE' | 'NOT_FOUND') =>
        createDomainEventsConsumer({
          rooms: () => ({
            applyEvents: async () => {
              throw new Error(new AppError(code).message);
            },
          }),
          logger: silentLogger,
        });
      await failing('UNAVAILABLE')(batch([msg(event([[S1, ['risk']]]), 3)]));
      expect(outcomes).toEqual([`retry:${backoffSeconds(3)}`]);
      outcomes.length = 0;
      await failing('NOT_FOUND')(batch([msg(event([[S1, ['risk']]]), 1)]));
      expect(outcomes).toEqual(['ack']);
    });
  });

  describe('stream fetch', () => {
    it('routes by the ticket prefix and rejects bad requests', async () => {
      const seen: string[] = [];
      const fetch = createStreamFetch(tid => ({
        fetch: async () => {
          seen.push(tid);
          return new Response('ok');
        },
      }));
      const url = (t: string) =>
        `https://app.example.com/api/v1/situation/stream?ticket=${t}`;
      const ws = {headers: {Upgrade: 'websocket'}};
      const good = `${T2}.abcdefghijklmnopqrstuvwxyz012345`;
      expect((await fetch(new Request(url(good)))).status).toBe(426);
      expect((await fetch(new Request(url('bad'), ws))).status).toBe(401);
      const res401 = await fetch(new Request(url('x.y'), ws));
      expect(await res401.json()).toMatchObject({code: 'UNAUTHENTICATED'});
      expect(await (await fetch(new Request(url(good), ws))).text()).toBe('ok');
      expect(seen).toEqual([T2]);
    });
  });

  describe('TenantLifecycle', () => {
    it('exports one page, purges to a tombstone, counts and closes streams', async () => {
      const lc = createSituationLifecycle(resolve);
      const a = room(TEST_TID);
      a.objects.put(S1, {risk: 90});
      await a.core.overview(testCtx(), {range: '24h'});
      const page = await lc.exportTenant(TEST_TID, null);
      expect(page.file).toBe('situation.json');
      expect(page.nextCursor).toBeNull();
      expect(JSON.parse(page.text).alerts).toHaveLength(1);

      const s = a.hub.accept({sub: 'u', actingAs: false, n: 1});
      await lc.closeStreams(TEST_TID, 4401);
      expect(s.closed?.code).toBe(4401);

      expect(await lc.countTenant(TEST_TID)).toBeGreaterThan(0);
      const res = await lc.purgeTenant(TEST_TID, 500);
      expect(res.done).toBe(true);
      expect(await lc.countTenant(TEST_TID)).toBe(0);
      // A never-used workspace is empty and purges immediately.
      expect(await lc.countTenant(T2)).toBe(0);
      expect(await lc.purgeTenant(T2, 500)).toEqual({deleted: 0, done: true});
    });
  });
});
