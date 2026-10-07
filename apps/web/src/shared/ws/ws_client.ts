/**
 * @fileoverview Realtime WebSocket client for `/api/v1/situation/stream`
 * (前端详细设计 6.3.3, V2.4 复核修正 #2).
 *
 * - Every (re)connect first obtains a 30 s single-use ticket (the caller's
 *   `connectUrl()` does `POST /situation/stream-tickets`), then opens
 *   `wss://<same host>/api/v1/situation/stream?ticket=…`.
 * - Application heartbeat: every `heartbeatMs` (default 25 s) the client
 *   sends `{"type":"ping"}`; the Durable Object's `setWebSocketAutoResponse`
 *   replies with `pong` without waking the object, keeping the Cloudflare
 *   edge from closing an idle connection at zero DO CPU cost.
 * - Tracks the server `seq`. After a reconnect it sends
 *   `{"type":"resume","lastSeq":n}` once; a gap during a session sends the
 *   same message and drops out-of-order frames until the replay (≤ 200) or
 *   a `snapshot` arrives.
 * - Reconnects with exponential backoff 1 s, 2 s, 4 s … 30 s, ±20% jitter.
 * - After 3 consecutive failures (or a server rejection because of the
 *   connection limit) it polls every 30 s (state `polling`) and keeps
 *   trying to reconnect in the background.
 * - Close code 4401 (trial ended): stop for good, `onEnded()`.
 * - `pause()` / `resume()` let the owner disconnect while every tab is
 *   hidden (> 5 min) and reconnect when one becomes visible.
 */

import {STREAM_CLOSE_EXPIRED} from '@ontodecide/shared-kernel';

/** Connection state exposed to the UI. */
export type WsState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'polling'
  | 'paused'
  | 'ended'
  | 'closed';

/** Server → client frame (situation contract `WsMsg`). */
export interface WsFrame {
  seq: number;
  type: string;
  data: unknown;
  occurredAt: string;
}

/** Minimal WebSocket surface (injectable for tests). */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: {code?: number}) => void) | null;
  onmessage: ((ev: {data: unknown}) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** Client options. */
export interface WsClientOptions {
  /**
   * Returns the URL for a (re)connect, including a fresh ticket; null or a
   * rejection counts as a failed attempt.
   */
  connectUrl(): Promise<string | null>;
  onFrame(frame: WsFrame): void;
  onState?(state: WsState): void;
  /** Called immediately and every `pollMs` while polling. */
  poll?(): Promise<unknown> | void;
  /** The server closed with 4401 (trial ended). */
  onEnded?(): void;
  createSocket?(url: string): SocketLike;
  random?(): number;
  maxBackoffMs?: number;
  pollMs?: number;
  failuresBeforePolling?: number;
  /** Heartbeat interval in ms (0 disables; default 25 s). */
  heartbeatMs?: number;
}

/** Boundary values (前端详细设计 表 11). */
export const WS_DEFAULTS = {
  maxBackoffMs: 30_000,
  pollMs: 30_000,
  failuresBeforePolling: 3,
  hiddenDisconnectMs: 5 * 60_000,
  /** Heartbeat interval: keeps the Cloudflare edge from closing an idle
   * WebSocket. The DO's `setWebSocketAutoResponse('ping','pong')` answers
   * without waking the object, so the heartbeat costs zero DO CPU. */
  heartbeatMs: 25_000,
} as const;

/** Close codes meaning "too many connections" (switch to polling at once). */
export const WS_LIMIT_CODES: readonly number[] = [1008, 1013, 4429];

/**
 * Backoff for the n-th consecutive failure (0-based): 1 s, 2 s, 4 s … capped
 * at `max`, with ±20% jitter (never above `max`).
 */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
  max: number = WS_DEFAULTS.maxBackoffMs,
): number {
  const base = Math.min(max, 1000 * 2 ** Math.max(0, attempt));
  const jitter = base * (random() * 0.4 - 0.2);
  return Math.max(0, Math.min(max, Math.round(base + jitter)));
}

/** Realtime client implementing the reconnect / replay state machine. */
export class WsClient {
  private socket: SocketLike | null = null;
  private state: WsState = 'idle';
  private lastSeq = 0;
  private failures = 0;
  private opened = false;
  private resumePending = false;
  private stopped = true;
  private paused = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readonly o: Required<
    Omit<WsClientOptions, 'onState' | 'poll' | 'onEnded'>
  > &
    Pick<WsClientOptions, 'onState' | 'poll' | 'onEnded'>;

  constructor(opts: WsClientOptions) {
    this.o = {
      createSocket: (url: string) =>
        new WebSocket(url) as unknown as SocketLike,
      random: Math.random,
      maxBackoffMs: WS_DEFAULTS.maxBackoffMs,
      pollMs: WS_DEFAULTS.pollMs,
      failuresBeforePolling: WS_DEFAULTS.failuresBeforePolling,
      heartbeatMs: WS_DEFAULTS.heartbeatMs,
      ...opts,
    };
  }

  /** Current state. */
  getState(): WsState {
    return this.state;
  }

  /** Last applied sequence number. */
  getLastSeq(): number {
    return this.lastSeq;
  }

  /** Consecutive failed attempts. */
  getFailures(): number {
    return this.failures;
  }

  /** Starts connecting. */
  start(): void {
    if (!this.stopped || this.state === 'ended') return;
    this.stopped = false;
    this.paused = false;
    void this.connect();
  }

  /** Stops everything (unmount, logout, leaving the admin view). */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.stopPolling();
    this.closeSocket();
    if (this.state !== 'ended') this.setState('closed');
  }

  /** Disconnects while all tabs are hidden. */
  pause(): void {
    if (this.stopped || this.paused) return;
    this.paused = true;
    this.clearTimers();
    this.stopPolling();
    this.closeSocket();
    this.setState('paused');
  }

  /** Reconnects after {@link pause}. */
  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    this.failures = 0;
    void this.connect();
  }

  private setState(s: WsState): void {
    if (this.state === s) return;
    this.state = s;
    this.o.onState?.(s);
  }

  private clearTimers(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private closeSocket(): void {
    const s = this.socket;
    this.socket = null;
    this.stopHeartbeat();
    if (!s) return;
    s.onopen = s.onclose = s.onmessage = s.onerror = null;
    try {
      s.close(1000, 'client');
    } catch {
      // Already closed.
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.paused) return;
    const attempt = ++this.attempt;
    if (this.state !== 'polling')
      this.setState(this.failures > 0 ? 'reconnecting' : 'connecting');
    let url: string | null = null;
    try {
      url = await this.o.connectUrl();
    } catch {
      url = null;
    }
    // Stopped, paused or superseded while the ticket was being fetched.
    if (this.stopped || this.paused || attempt !== this.attempt) return;
    if (!url) {
      this.fail(false);
      return;
    }
    this.opened = false;
    let sock: SocketLike;
    try {
      sock = this.o.createSocket(url);
    } catch {
      this.fail(false);
      return;
    }
    this.socket = sock;
    sock.onopen = () => this.handleOpen();
    sock.onmessage = ev => this.handleMessage(ev.data);
    sock.onclose = ev => this.handleClose(ev?.code);
    sock.onerror = () => {
      // A close event follows.
    };
  }

  private handleOpen(): void {
    this.opened = true;
    this.failures = 0;
    this.stopPolling();
    this.startHeartbeat();
    this.setState('open');
    if (this.lastSeq > 0) {
      // Reconnect: ask for the missed increments (or a fresh snapshot).
      this.resumePending = true;
      this.send({type: 'resume', lastSeq: this.lastSeq});
    } else {
      this.resumePending = false;
    }
  }

  private handleClose(code: number | undefined): void {
    this.socket = null;
    this.stopHeartbeat();
    if (this.stopped || this.paused) return;
    if (code === STREAM_CLOSE_EXPIRED) {
      this.stopped = true;
      this.clearTimers();
      this.stopPolling();
      this.setState('ended');
      this.o.onEnded?.();
      return;
    }
    if (code !== undefined && WS_LIMIT_CODES.includes(code)) {
      this.fail(true);
      return;
    }
    if (this.opened) {
      // Dropped after a successful open: retry quickly.
      this.opened = false;
      this.failures = 0;
      this.scheduleReconnect(
        backoffDelay(0, this.o.random, this.o.maxBackoffMs),
        'reconnecting',
      );
      return;
    }
    this.fail(false);
  }

  private fail(limit: boolean): void {
    const delay = backoffDelay(
      this.failures,
      this.o.random,
      this.o.maxBackoffMs,
    );
    this.failures += 1;
    if (limit || this.failures >= this.o.failuresBeforePolling)
      this.startPolling();
    this.scheduleReconnect(delay, this.pollTimer ? 'polling' : 'reconnecting');
  }

  private scheduleReconnect(delay: number, state: WsState): void {
    clearTimeout(this.reconnectTimer);
    this.setState(state);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private startPolling(): void {
    if (this.pollTimer || !this.o.poll) return;
    const run = () => {
      try {
        void Promise.resolve(this.o.poll?.()).catch(() => {});
      } catch {
        // Polling errors are retried at the next interval.
      }
    };
    run();
    this.pollTimer = setInterval(run, this.o.pollMs);
  }

  private stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  /**
   * Sends a `ping` frame every `heartbeatMs` to keep the Cloudflare edge
   * from closing an idle WebSocket. The DO's `setWebSocketAutoResponse`
   * replies with `pong` without waking the object. The auto-response
   * matches the literal string "ping", so we bypass {@link send} (which
   * JSON-encodes) and write the raw string.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const ms = this.o.heartbeatMs;
    if (!ms || ms <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      try {
        this.socket?.send('ping');
      } catch {
        // Not open; the close handler takes over.
      }
    }, ms);
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private send(msg: unknown): void {
    try {
      this.socket?.send(JSON.stringify(msg));
    } catch {
      // Not open; the close handler takes over.
    }
  }

  private handleMessage(raw: unknown): void {
    let frame: WsFrame;
    try {
      frame = (typeof raw === 'string' ? JSON.parse(raw) : raw) as WsFrame;
    } catch {
      return;
    }
    if (
      !frame ||
      typeof frame.seq !== 'number' ||
      typeof frame.type !== 'string'
    )
      return;
    if (frame.type === 'snapshot') {
      this.lastSeq = frame.seq;
      this.resumePending = false;
      this.o.onFrame(frame);
      return;
    }
    if (this.lastSeq === 0 || frame.seq === this.lastSeq + 1) {
      this.lastSeq = frame.seq;
      this.resumePending = false;
      this.o.onFrame(frame);
      return;
    }
    if (frame.seq <= this.lastSeq) return; // duplicate
    // Gap: ask for a replay once and drop until it arrives.
    if (!this.resumePending) {
      this.resumePending = true;
      this.send({type: 'resume', lastSeq: this.lastSeq});
    }
  }
}
