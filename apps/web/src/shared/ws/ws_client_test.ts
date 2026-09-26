/**
 * @fileoverview Reconnect state machine: backoff with jitter, polling after
 * 3 failures, seq tracking with resume on gaps, heartbeat, hidden-page
 * disconnect.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  backoffDelay,
  type SocketLike,
  type WsFrame,
  WsClient,
  type WsState,
} from './ws_client';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: {data: unknown}) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  fail() {
    this.onclose?.({});
  }
  msg(f: Partial<WsFrame>) {
    this.onmessage?.({
      data: JSON.stringify({occurredAt: '', data: null, ...f}),
    });
  }
}

class FakeDoc {
  visibilityState = 'visible';
  private cbs = new Set<() => void>();
  addEventListener(_t: string, cb: () => void) {
    this.cbs.add(cb);
  }
  removeEventListener(_t: string, cb: () => void) {
    this.cbs.delete(cb);
  }
  set(v: 'visible' | 'hidden') {
    this.visibilityState = v;
    for (const cb of this.cbs) cb();
  }
}

function setup(extra: {random?: () => number; doc?: FakeDoc} = {}) {
  const frames: WsFrame[] = [];
  const states: WsState[] = [];
  const poll = vi.fn(async () => {});
  const client = new WsClient({
    url: lastSeq => `ws://x/stream?lastSeq=${lastSeq}`,
    onFrame: f => frames.push(f),
    onState: s => states.push(s),
    poll,
    createSocket: url => new FakeSocket(url),
    random: extra.random ?? (() => 0.5),
    visibility: extra.doc ?? null,
  });
  return {client, frames, states, poll, last: () => FakeSocket.all.at(-1)!};
}

describe('backoffDelay', () => {
  it('doubles from 1 s up to 30 s', () => {
    const mid = () => 0.5; // zero jitter
    expect([0, 1, 2, 3, 4, 5, 6].map(a => backoffDelay(a, mid))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it('applies ±20% jitter and never exceeds the cap', () => {
    expect(backoffDelay(2, () => 0)).toBe(3200);
    expect(backoffDelay(2, () => 0.999999)).toBe(4800);
    expect(backoffDelay(10, () => 0.999999)).toBe(30000);
    expect(backoffDelay(10, () => 0)).toBe(24000);
  });
});

describe('WsClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });
  afterEach(() => vi.useRealTimers());

  it('connects, opens and sends heartbeats every 30 s', () => {
    const {client, states, last} = setup();
    client.start();
    expect(states).toEqual(['connecting']);
    last().open();
    expect(client.getState()).toBe('open');
    vi.advanceTimersByTime(30_000);
    expect(last().sent).toEqual([{type: 'ping'}]);
    vi.advanceTimersByTime(30_000);
    expect(last().sent).toHaveLength(2);
    client.stop();
  });

  it('delivers contiguous frames and drops duplicates', () => {
    const {client, frames, last} = setup();
    client.start();
    last().open();
    last().msg({seq: 1, type: 'kpi'});
    last().msg({seq: 2, type: 'alert'});
    last().msg({seq: 2, type: 'alert'});
    expect(frames.map(f => f.seq)).toEqual([1, 2]);
    expect(client.getLastSeq()).toBe(2);
    client.stop();
  });

  it('requests a resume on a gap and waits for the replay', () => {
    const {client, frames, last} = setup();
    client.start();
    last().open();
    last().msg({seq: 1, type: 'kpi'});
    last().msg({seq: 4, type: 'kpi'});
    last().msg({seq: 5, type: 'kpi'});
    expect(last().sent).toEqual([{type: 'resume', lastSeq: 1}]);
    expect(frames.map(f => f.seq)).toEqual([1]);
    // Server replays 2..5.
    for (const s of [2, 3, 4, 5]) last().msg({seq: s, type: 'kpi'});
    expect(frames.map(f => f.seq)).toEqual([1, 2, 3, 4, 5]);
    client.stop();
  });

  it('replaces state on snapshot regardless of seq', () => {
    const {client, frames, last} = setup();
    client.start();
    last().open();
    last().msg({seq: 3, type: 'kpi'});
    last().msg({seq: 90, type: 'snapshot'});
    last().msg({seq: 91, type: 'alert'});
    expect(frames.map(f => f.seq)).toEqual([3, 90, 91]);
    client.stop();
  });

  it('reconnects with backoff carrying lastSeq, then polls after 3 failures', () => {
    const {client, poll, last, states} = setup();
    client.start();
    last().open();
    last().msg({seq: 7, type: 'kpi'});
    last().fail(); // drop after open → reconnect in ~1 s
    expect(client.getState()).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    expect(last().url).toContain('lastSeq=7');

    last().fail(); // failure 1 → wait 1 s
    vi.advanceTimersByTime(1000);
    last().fail(); // failure 2 → wait 2 s
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    last().fail(); // failure 3 → polling + wait 4 s
    expect(client.getState()).toBe('polling');
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(states).toContain('polling');

    // The background attempt made during polling fails too, then succeeds.
    expect(client.getState()).toBe('polling');
    const before = FakeSocket.all.length;
    last().fail();
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.all.length).toBe(before + 1);
    last().open();
    expect(client.getState()).toBe('open');
    const calls = poll.mock.calls.length;
    vi.advanceTimersByTime(90_000);
    expect(poll.mock.calls.length).toBe(calls);
    client.stop();
  });

  it('caps the backoff at 30 s', () => {
    const {client, last} = setup();
    client.start();
    for (let i = 0; i < 8; i++) {
      last().fail();
      vi.advanceTimersByTime(30_000);
    }
    const n = FakeSocket.all.length;
    last().fail();
    vi.advanceTimersByTime(29_999);
    expect(FakeSocket.all.length).toBe(n);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all.length).toBe(n + 1);
    client.stop();
  });

  it('disconnects after 5 minutes hidden and reconnects when visible', () => {
    const doc = new FakeDoc();
    const {client, last} = setup({doc});
    client.start();
    last().open();
    doc.set('hidden');
    vi.advanceTimersByTime(4 * 60_000);
    expect(client.getState()).toBe('open');
    vi.advanceTimersByTime(60_000);
    expect(client.getState()).toBe('paused');
    expect(last().closed).toBe(true);
    const n = FakeSocket.all.length;
    doc.set('visible');
    expect(FakeSocket.all.length).toBe(n + 1);
    last().open();
    expect(client.getState()).toBe('open');
    client.stop();
  });

  it('coming back quickly keeps the connection', () => {
    const doc = new FakeDoc();
    const {client, last} = setup({doc});
    client.start();
    last().open();
    doc.set('hidden');
    vi.advanceTimersByTime(60_000);
    doc.set('visible');
    vi.advanceTimersByTime(10 * 60_000);
    expect(client.getState()).toBe('open');
    expect(FakeSocket.all).toHaveLength(1);
    client.stop();
  });

  it('stop() closes and prevents reconnects', () => {
    const {client, last} = setup();
    client.start();
    last().open();
    client.stop();
    expect(last().closed).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(client.getState()).toBe('closed');
  });
});
