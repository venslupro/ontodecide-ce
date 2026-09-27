/**
 * @fileoverview WsClient: ticket per connect, no app heartbeat, resume
 * after reconnect, gap handling, backoff with jitter, polling after 3
 * failures or a limit close, pause / resume, close 4401 stops for good.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  backoffDelay,
  WsClient,
  type SocketLike,
  type WsState,
} from './ws_client';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: {code?: number}) => void) | null = null;
  onmessage: ((ev: {data: unknown}) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  drop(code = 1006) {
    this.onclose?.({code});
  }
  msg(frame: unknown) {
    this.onmessage?.({data: JSON.stringify(frame)});
  }
}

function setup(over: Partial<ConstructorParameters<typeof WsClient>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const states: WsState[] = [];
  const frames: {seq: number; type: string}[] = [];
  let tickets = 0;
  const poll = vi.fn();
  const onEnded = vi.fn();
  const client = new WsClient({
    connectUrl: async () =>
      `wss://app/api/v1/situation/stream?ticket=t${++tickets}`,
    onFrame: f => frames.push(f),
    onState: s => states.push(s),
    poll,
    onEnded,
    random: () => 0.5,
    createSocket: url => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    ...over,
  });
  return {
    client,
    sockets,
    states,
    frames,
    poll,
    onEnded,
    tickets: () => tickets,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('backoffDelay', () => {
  it('doubles from 1 s up to 30 s with ±20% jitter', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, () => 0.5)).toBe(8000);
    expect(backoffDelay(10, () => 0.5)).toBe(30000);
    expect(backoffDelay(1, () => 0)).toBe(1600);
    expect(backoffDelay(1, () => 1)).toBe(2400);
    expect(backoffDelay(10, () => 1)).toBe(30000);
  });
});

describe('WsClient', () => {
  it('fetches a fresh ticket for every connection and sends no heartbeat', async () => {
    const t = setup();
    t.client.start();
    await flush();
    expect(t.sockets[0].url).toContain('ticket=t1');
    t.sockets[0].open();
    expect(t.states.at(-1)).toBe('open');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.sockets[0].sent).toEqual([]);
    t.sockets[0].drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sockets[1].url).toContain('ticket=t2');
  });

  it('applies consecutive frames, requests a replay on a gap, drops duplicates', async () => {
    const t = setup();
    t.client.start();
    await flush();
    const s = t.sockets[0];
    s.open();
    s.msg({seq: 1, type: 'snapshot', data: {}, occurredAt: ''});
    s.msg({seq: 2, type: 'kpi', data: {}, occurredAt: ''});
    s.msg({seq: 2, type: 'kpi', data: {}, occurredAt: ''});
    s.msg({seq: 5, type: 'alert', data: {}, occurredAt: ''});
    s.msg({seq: 6, type: 'alert', data: {}, occurredAt: ''});
    expect(t.frames.map(f => f.seq)).toEqual([1, 2]);
    expect(s.sent).toEqual([JSON.stringify({type: 'resume', lastSeq: 2})]);
    s.msg({seq: 3, type: 'kpi', data: {}, occurredAt: ''});
    expect(t.client.getLastSeq()).toBe(3);
  });

  it('sends resume with lastSeq after a reconnect', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.sockets[0].open();
    t.sockets[0].msg({seq: 1, type: 'snapshot', data: {}, occurredAt: ''});
    t.sockets[0].msg({seq: 2, type: 'kpi', data: {}, occurredAt: ''});
    t.sockets[0].drop();
    await vi.advanceTimersByTimeAsync(1000);
    t.sockets[1].open();
    expect(t.sockets[1].sent).toEqual([
      JSON.stringify({type: 'resume', lastSeq: 2}),
    ]);
  });

  it('polls every 30 s after 3 failed attempts and keeps reconnecting', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.sockets[0].drop();
    await vi.advanceTimersByTimeAsync(1000);
    t.sockets[1].drop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.poll).not.toHaveBeenCalled();
    t.sockets[2].drop();
    expect(t.poll).toHaveBeenCalledTimes(1);
    expect(t.states.at(-1)).toBe('polling');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.poll.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(t.sockets.length).toBeGreaterThan(3);
    t.sockets.at(-1)!.open();
    expect(t.states.at(-1)).toBe('open');
    const n = t.poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.poll.mock.calls.length).toBe(n);
  });

  it('switches to polling at once when the server rejects over the connection limit', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.sockets[0].drop(4429);
    expect(t.poll).toHaveBeenCalledTimes(1);
    expect(t.states.at(-1)).toBe('polling');
  });

  it('counts a failed ticket request as a failed attempt', async () => {
    const t = setup({connectUrl: async () => null});
    t.client.start();
    await flush();
    expect(t.client.getFailures()).toBe(1);
    expect(t.states.at(-1)).toBe('reconnecting');
  });

  it('stops for good on close code 4401', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.sockets[0].open();
    t.sockets[0].drop(4401);
    expect(t.onEnded).toHaveBeenCalledTimes(1);
    expect(t.states.at(-1)).toBe('ended');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.sockets).toHaveLength(1);
    t.client.start();
    await flush();
    expect(t.sockets).toHaveLength(1);
  });

  it('pause disconnects; resume reconnects with a new ticket', async () => {
    const t = setup();
    t.client.start();
    await flush();
    t.sockets[0].open();
    t.client.pause();
    expect(t.sockets[0].closed).toBe(true);
    expect(t.states.at(-1)).toBe('paused');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.sockets).toHaveLength(1);
    t.client.resume();
    await flush();
    expect(t.sockets).toHaveLength(2);
    expect(t.tickets()).toBe(2);
  });
});
