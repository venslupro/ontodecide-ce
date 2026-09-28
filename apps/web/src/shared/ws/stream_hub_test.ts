/**
 * @fileoverview StreamHub: one leader per browser (Web Locks), frames and
 * state fan out over BroadcastChannel, hand-over when the leader stops,
 * disconnect after 5 minutes with every tab hidden.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  StreamHub,
  type ChannelLike,
  type ClientHandlers,
  type ClientLike,
  type LockManagerLike,
  type VisibilitySource,
} from './stream_hub';
import type {WsFrame, WsState} from './ws_client';

class Bus {
  channels = new Set<FakeChannel>();
}
class FakeChannel implements ChannelLike {
  onmessage: ((ev: {data: unknown}) => void) | null = null;
  constructor(private readonly bus: Bus) {
    bus.channels.add(this);
  }
  postMessage(msg: unknown) {
    for (const c of this.bus.channels)
      if (c !== this) c.onmessage?.({data: structuredClone(msg)});
  }
  close() {
    this.bus.channels.delete(this);
  }
}

class FakeLocks implements LockManagerLike {
  private held = false;
  private queue: (() => Promise<unknown>)[] = [];
  request(_name: string, cb: () => Promise<unknown>) {
    if (!this.held) return this.grant(cb);
    return new Promise(res => this.queue.push(() => this.grant(cb).then(res)));
  }
  private grant(cb: () => Promise<unknown>) {
    this.held = true;
    return cb().finally(() => {
      this.held = false;
      const next = this.queue.shift();
      if (next) void next();
    });
  }
}

class Vis implements VisibilitySource {
  visibilityState = 'visible';
  private cbs = new Set<() => void>();
  addEventListener(_t: 'visibilitychange', cb: () => void) {
    this.cbs.add(cb);
  }
  removeEventListener(_t: 'visibilitychange', cb: () => void) {
    this.cbs.delete(cb);
  }
  set(v: 'visible' | 'hidden') {
    this.visibilityState = v;
    for (const cb of this.cbs) cb();
  }
}

function fakeClient(log: string[], handlers: {current?: ClientHandlers}) {
  return (h: ClientHandlers): ClientLike => {
    handlers.current = h;
    let state: WsState = 'idle';
    return {
      start: () => {
        log.push('start');
        state = 'open';
        h.onState('open');
      },
      stop: () => log.push('stop'),
      pause: () => log.push('pause'),
      resume: () => log.push('resume'),
      getState: () => state,
    };
  };
}

const frame = (seq: number): WsFrame => ({
  seq,
  type: 'kpi',
  data: {},
  occurredAt: '',
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('StreamHub', () => {
  it('only the leader connects; followers receive frames and state', async () => {
    const bus = new Bus();
    const locks = new FakeLocks();
    const logA: string[] = [];
    const logB: string[] = [];
    const hA: {current?: ClientHandlers} = {};
    const framesB: number[] = [];
    const statesB: WsState[] = [];
    const a = new StreamHub({
      scope: 'ws1',
      locks,
      createChannel: () => new FakeChannel(bus),
      visibility: null,
      createClient: fakeClient(logA, hA),
      onFrame: () => {},
      onState: () => {},
      onEnded: () => {},
    });
    const b = new StreamHub({
      scope: 'ws1',
      locks,
      createChannel: () => new FakeChannel(bus),
      visibility: null,
      createClient: fakeClient(logB, {}),
      onFrame: f => framesB.push(f.seq),
      onState: s => statesB.push(s),
      onEnded: () => {},
    });
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    expect(logA).toEqual(['start']);
    expect(logB).toEqual([]);
    hA.current!.onFrame(frame(1));
    expect(framesB).toEqual([1]);
    expect(statesB).toContain('open');
    // Leader leaves: the follower takes over.
    a.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.isLeader()).toBe(true);
    expect(logB).toEqual(['start']);
    b.stop();
  });

  it('becomes leader directly without Web Locks', () => {
    const log: string[] = [];
    const hub = new StreamHub({
      scope: 'ws1',
      locks: null,
      createChannel: null,
      visibility: null,
      createClient: fakeClient(log, {}),
      onFrame: () => {},
      onState: () => {},
      onEnded: () => {},
    });
    hub.start();
    expect(hub.isLeader()).toBe(true);
    expect(log).toEqual(['start']);
    hub.stop();
    expect(log).toEqual(['start', 'stop']);
  });

  it('pauses after 5 minutes with every tab hidden and resumes when visible', async () => {
    const log: string[] = [];
    const vis = new Vis();
    const hub = new StreamHub({
      scope: 'ws1',
      locks: null,
      createChannel: null,
      visibility: vis,
      createClient: fakeClient(log, {}),
      onFrame: () => {},
      onState: () => {},
      onEnded: () => {},
    });
    hub.start();
    vis.set('hidden');
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(log).not.toContain('pause');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log).toContain('pause');
    vis.set('visible');
    expect(log.at(-1)).toBe('resume');
    hub.stop();
  });

  it('stays connected while another tab is visible', async () => {
    const bus = new Bus();
    const log: string[] = [];
    const visA = new Vis();
    const visB = new Vis();
    const a = new StreamHub({
      scope: 'ws1',
      locks: null,
      createChannel: () => new FakeChannel(bus),
      visibility: visA,
      createClient: fakeClient(log, {}),
      onFrame: () => {},
      onState: () => {},
      onEnded: () => {},
    });
    const b = new StreamHub({
      scope: 'ws1',
      locks: new FakeLocks(),
      createChannel: () => new FakeChannel(bus),
      visibility: visB,
      createClient: fakeClient([], {}),
      onFrame: () => {},
      onState: () => {},
      onEnded: () => {},
    });
    // b uses its own lock manager but a is leader via no-locks; b must not
    // matter for connections here, only for visibility reports.
    a.start();
    b.start();
    visA.set('hidden');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(log).not.toContain('pause');
    a.stop();
    b.stop();
  });

  it('propagates the trial end to followers', async () => {
    const bus = new Bus();
    const locks = new FakeLocks();
    const hA: {current?: ClientHandlers} = {};
    const endedB = vi.fn();
    const a = new StreamHub({
      scope: 'ws1',
      locks,
      createChannel: () => new FakeChannel(bus),
      visibility: null,
      createClient: fakeClient([], hA),
      onFrame: () => {},
      onState: () => {},
      onEnded: () => {},
    });
    const b = new StreamHub({
      scope: 'ws1',
      locks,
      createChannel: () => new FakeChannel(bus),
      visibility: null,
      createClient: fakeClient([], {}),
      onFrame: () => {},
      onState: () => {},
      onEnded: endedB,
    });
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    hA.current!.onEnded();
    expect(endedB).toHaveBeenCalledTimes(1);
    a.stop();
    b.stop();
  });

  it('follower tabs receive frames the leader produces itself (poll results)', async () => {
    const bus = new Bus();
    const locks = new FakeLocks();
    const hA: {current?: ClientHandlers} = {};
    const got: string[] = [];
    const a = new StreamHub({
      scope: 'ws1',
      locks,
      createChannel: () => new FakeChannel(bus),
      visibility: null,
      createClient: fakeClient([], hA),
      onFrame: () => {},
      onState: () => {},
      onEnded: () => {},
    });
    const b = new StreamHub({
      scope: 'ws1',
      locks,
      createChannel: () => new FakeChannel(bus),
      visibility: null,
      createClient: fakeClient([], {}),
      onFrame: fr => got.push(fr.type),
      onState: () => {},
      onEnded: () => {},
    });
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    hA.current!.onState('polling');
    hA.current!.onFrame({seq: 0, type: 'poll', data: {}, occurredAt: ''});
    expect(got).toEqual(['poll']);
    a.stop();
    b.stop();
  });

  it('a new leader learns the visibility of tabs opened before it', async () => {
    const bus = new Bus();
    const locks = new FakeLocks();
    // B never wins the lock (its request stays pending).
    const never: LockManagerLike = {request: () => new Promise(() => {})};
    const logC: string[] = [];
    const visA = new Vis();
    const visB = new Vis();
    const visC = new Vis();
    const hub = (vis: Vis, l: LockManagerLike, log: string[] = []): StreamHub =>
      new StreamHub({
        scope: 'ws1',
        locks: l,
        createChannel: () => new FakeChannel(bus),
        visibility: vis,
        createClient: fakeClient(log, {}),
        onFrame: () => {},
        onState: () => {},
        onEnded: () => {},
      });
    visA.set('hidden');
    visC.set('hidden');
    const a = hub(visA, locks);
    const b = hub(visB, never); // visible, opened before C
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    const c = hub(visC, locks, logC);
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    // A (hidden) leaves; C (hidden) takes over while B is still visible.
    a.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.isLeader()).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(logC).toEqual(['start']);
    // Once B hides too, C pauses after 5 minutes.
    visB.set('hidden');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(logC).toContain('pause');
    b.stop();
    c.stop();
  });
});
