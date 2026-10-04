/**
 * @fileoverview situation-awareness service tests: the composed service
 * over FakeDoNamespace rooms (RPC, domain-events queue, lifecycle, stream
 * fetch guards) and the Durable Object runtime adapters.
 */

import {describe, expect, it} from 'vitest';
import {FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import type {SituationRoomCore} from '@ontodecide/situation/application';
import {
  InMemoryRoomStorage,
  MemorySocketHub,
} from '@ontodecide/situation/infrastructure';
import {
  FakeDoNamespace,
  MemorySqlStorage,
  QueueBus,
  TEST_TID,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import {
  FakeObjects,
  FakeOntology,
  event,
} from '../../../packages/situation/infrastructure/room_test_fixtures';
import {DoRoomStorage, DoSocketHub, wrapSocket} from './durable_objects';
import type {Env} from './env';
import {createRoomCore, createService} from './service';

const S1 = 'ri.Supplier.01K6A0000000000000000000S1';

function setup() {
  const objects = new FakeObjects();
  const ontology = new FakeOntology();
  const clock = new FixedClock('2026-09-24T10:00:00Z');
  const hubs = new Map<string, MemorySocketHub>();
  const env = {} as Env;
  const ns = new FakeDoNamespace<SituationRoomCore>(name => {
    const sql = new MemorySqlStorage();
    const hub = new MemorySocketHub();
    hubs.set(name, hub);
    return createRoomCore(
      env,
      {sql, storage: new InMemoryRoomStorage(sql), sockets: hub},
      {clock, logger: silentLogger},
    );
  });
  Object.assign(env, {
    SITUATION_ROOM: ns.asNamespace(),
    OBJECTS: rpcBinding(objects) as unknown as Env['OBJECTS'],
    ONTOLOGY: rpcBinding(ontology) as unknown as Env['ONTOLOGY'],
    APP_ORIGIN: 'https://ontodecide-ce.example.com',
    ENVIRONMENT: 'test',
  } satisfies Env);
  const svc = createService(env, {clock, logger: silentLogger});
  return {svc, objects, ontology, ns, hubs, clock};
}

describe('situation-awareness service', () => {
  it('serves the cockpit and consumes domain-events end to end', async () => {
    const {svc, objects} = setup();
    objects.put(S1, {risk: 10});
    const ctx = testCtx();
    const first = await svc.rpc.overview(ctx, {range: '24h'});
    expect(first.initialized).toBe(true);
    expect(first.alerts).toHaveLength(0);

    objects.put(S1, {risk: 95});
    const bus = new QueueBus();
    await bus
      .sender('ontodecide-prd-domain-events')
      .send(event([[S1, ['risk']]]));
    await bus.drain({
      'ontodecide-prd-domain-events': {
        handler: b => svc.queue(b),
        deadLetterQueue: 'ontodecide-prd-dead-letter',
      },
    });
    expect(bus.size('ontodecide-prd-dead-letter')).toBe(0);
    const after = await svc.rpc.overview(ctx, {range: '24h'});
    expect(after.alerts).toHaveLength(1);
    const acked = await svc.rpc.acknowledgeAlert(ctx, after.alerts[0].id);
    expect(acked.status).toBe('ACKED');

    const {ticket} = await svc.rpc.issueStreamTicket(ctx);
    expect(ticket.startsWith(`${TEST_TID}.`)).toBe(true);
  });

  it('exposes the lifecycle entry point', async () => {
    const {svc, objects, hubs} = setup();
    objects.put(S1, {risk: 95});
    await svc.rpc.overview(testCtx(), {range: '24h'});
    const page = await svc.lifecycle.exportTenant(TEST_TID, null);
    expect(page).toMatchObject({file: 'situation.json', nextCursor: null});
    const s = hubs.get(TEST_TID)!.accept({sub: 'u', actingAs: false, n: 1});
    await svc.lifecycle.closeStreams(TEST_TID, 4401);
    expect(s.closed?.code).toBe(4401);
    expect((await svc.lifecycle.purgeTenant(TEST_TID, 500)).done).toBe(true);
    expect(await svc.lifecycle.countTenant(TEST_TID)).toBe(0);
  });

  it('guards the stream endpoint (Origin, upgrade, ticket)', async () => {
    const {svc, ns} = setup();
    const url = `https://ontodecide-ce.example.com/api/v1/situation/stream?ticket=${TEST_TID}.abcdefghijklmnopqrstuvwx`;
    const upgrade = {Upgrade: 'websocket'};
    const evil = await svc.fetch(
      new Request(url, {headers: {...upgrade, Origin: 'https://evil.example'}}),
    );
    expect(evil.status).toBe(403);
    expect((await svc.fetch(new Request(url))).status).toBe(426);
    const bad = await svc.fetch(
      new Request(
        'https://ontodecide-ce.example.com/api/v1/situation/stream?ticket=x',
        {
          headers: {...upgrade, Origin: 'https://ontodecide-ce.example.com'},
        },
      ),
    );
    expect(bad.status).toBe(401);
    expect(ns.instances.size).toBe(0);
  });
});

describe('Durable Object adapters', () => {
  it('wraps hibernatable sockets and storage', async () => {
    const calls: string[] = [];
    const fakeWs = (sub: string, n: number) =>
      ({
        deserializeAttachment: () => ({sub, actingAs: false, n}),
        send: (t: string) => calls.push(`send:${sub}:${t}`),
        close: (c: number) => calls.push(`close:${sub}:${c}`),
      }) as unknown as WebSocket;
    const sockets = [fakeWs('a', 1), fakeWs('b', 2)];
    const state = {
      getWebSockets: (tag?: string) =>
        tag ? sockets.filter(s => wrapSocket(s).meta.sub === tag) : sockets,
    } as unknown as DurableObjectState;
    const hub = new DoSocketHub(state);
    expect(hub.list().map(s => s.meta.n)).toEqual([1, 2]);
    const [b] = hub.list('b');
    b.send('x');
    b.close(4401, 'bye');
    expect(calls).toEqual(['send:b:x', 'close:b:4401']);

    let alarm: number | null = null;
    const storage = new DoRoomStorage({
      deleteAll: async () => calls.push('deleteAll'),
      getAlarm: async () => alarm,
      setAlarm: async (t: number) => void (alarm = t),
      deleteAlarm: async () => void (alarm = null),
    } as unknown as DurableObjectStorage);
    await storage.setAlarm(5);
    expect(await storage.getAlarm()).toBe(5);
    await storage.deleteAlarm();
    expect(await storage.getAlarm()).toBeNull();
    await storage.deleteAll();
    expect(calls).toContain('deleteAll');
  });
});
