/**
 * @fileoverview Realtime WebSocket client for `/api/v1/situation/stream`
 * (前端详细设计 §WebSocket 重连与补发).
 *
 * - Tracks the server `seq`; a gap sends `{"type":"resume","lastSeq":n}`
 *   and drops out-of-order frames until the replay (or a snapshot) arrives.
 * - Reconnects with exponential backoff 1 s → 30 s with ±20% jitter, the URL
 *   carrying `lastSeq`.
 * - After 3 consecutive failed attempts it falls back to polling every 30 s
 *   (state `polling`) while reconnect attempts continue in the background.
 * - Heartbeat `{"type":"ping"}` every 30 s.
 * - Disconnects after the page has been hidden for 5 minutes, reconnects
 *   when it becomes visible again.
 */

/** Connection state exposed to the UI. */
export type WsState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'polling'
  | 'paused'
  | 'closed';

/** Server → client frame. */
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
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: {data: unknown}) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** Minimal document surface for visibility handling. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
  removeEventListener(type: 'visibilitychange', cb: () => void): void;
}

/** Client options. */
export interface WsClientOptions {
  /** Builds the URL for a (re)connect given the last seen seq. */
  url(lastSeq: number): string | null;
  onFrame(frame: WsFrame): void;
  onState?(state: WsState): void;
  /** Called immediately and every `pollMs` while in polling mode. */
  poll?(): Promise<unknown> | void;
  createSocket?(url: string): SocketLike;
  random?(): number;
  visibility?: VisibilitySource | null;
  heartbeatMs?: number;
  maxBackoffMs?: number;
  pollMs?: number;
  failuresBeforePolling?: number;
  hiddenDisconnectMs?: number;
}

/** Boundary values (前端详细设计 表 9). */
export const WS_DEFAULTS = {
  heartbeatMs: 30_000,
  maxBackoffMs: 30_000,
  pollMs: 30_000,
  failuresBeforePolling: 3,
  hiddenDisconnectMs: 5 * 60_000,
} as const;

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
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly o: Required<
    Omit<WsClientOptions, 'onState' | 'poll' | 'visibility'>
  > &
    Pick<WsClientOptions, 'onState' | 'poll' | 'visibility'>;

  constructor(opts: WsClientOptions) {
    this.o = {
      createSocket: (url: string) =>
        new WebSocket(url) as unknown as SocketLike,
      random: Math.random,
      ...WS_DEFAULTS,
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

  /** Number of consecutive failed connection attempts. */
  getFailures(): number {
    return this.failures;
  }

  /** Starts connecting and listening to visibility changes. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.o.visibility?.addEventListener('visibilitychange', this.onVisibility);
    this.connect();
  }

  /** Stops everything (unmount / logout). */
  stop(): void {
    this.stopped = true;
    this.o.visibility?.removeEventListener(
      'visibilitychange',
      this.onVisibility,
    );
    this.clearTimers();
    this.stopPolling();
    this.closeSocket();
    this.setState('closed');
  }

  private setState(s: WsState): void {
    if (this.state === s) return;
    this.state = s;
    this.o.onState?.(s);
  }

  private clearTimers(): void {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.hiddenTimer);
    this.reconnectTimer = undefined;
    this.heartbeatTimer = undefined;
    this.hiddenTimer = undefined;
  }

  private closeSocket(): void {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onopen = s.onclose = s.onmessage = s.onerror = null;
    try {
      s.close(1000, 'client');
    } catch {
      // ignore
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const url = this.o.url(this.lastSeq);
    if (!url) {
      this.fail();
      return;
    }
    if (this.state !== 'polling')
      this.setState(this.failures > 0 ? 'reconnecting' : 'connecting');
    this.opened = false;
    let sock: SocketLike;
    try {
      sock = this.o.createSocket(url);
    } catch {
      this.fail();
      return;
    }
    this.socket = sock;
    sock.onopen = () => this.handleOpen();
    sock.onmessage = ev => this.handleMessage(ev.data);
    sock.onclose = () => this.handleClose();
    sock.onerror = () => {
      /* close follows */
    };
  }

  private handleOpen(): void {
    this.opened = true;
    this.failures = 0;
    this.resumePending = false;
    this.stopPolling();
    this.setState('open');
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(
      () => this.send({type: 'ping'}),
      this.o.heartbeatMs,
    );
  }

  private handleClose(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.socket = null;
    if (this.stopped || this.state === 'paused') return;
    if (this.opened) {
      // Dropped after a successful open: retry quickly.
      this.failures = 0;
      this.opened = false;
      this.scheduleReconnect(
        backoffDelay(0, this.o.random, this.o.maxBackoffMs),
        'reconnecting',
      );
      return;
    }
    this.fail();
  }

  private fail(): void {
    const delay = backoffDelay(
      this.failures,
      this.o.random,
      this.o.maxBackoffMs,
    );
    this.failures += 1;
    if (this.failures >= this.o.failuresBeforePolling) this.startPolling();
    this.scheduleReconnect(delay, this.pollTimer ? 'polling' : 'reconnecting');
  }

  private scheduleReconnect(delay: number, state: WsState): void {
    clearTimeout(this.reconnectTimer);
    this.setState(state);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startPolling(): void {
    if (this.pollTimer || !this.o.poll) return;
    const run = () => {
      try {
        void Promise.resolve(this.o.poll?.()).catch(() => {});
      } catch {
        // ignore
      }
    };
    run();
    this.pollTimer = setInterval(run, this.o.pollMs);
  }

  private stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private send(msg: unknown): void {
    try {
      this.socket?.send(JSON.stringify(msg));
    } catch {
      // Socket not open; the close handler takes over.
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
    if ((frame.type as string) === 'pong') return;
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
    // Gap: ask for a replay and drop until it arrives.
    if (!this.resumePending) {
      this.resumePending = true;
      this.send({type: 'resume', lastSeq: this.lastSeq});
    }
  }

  private readonly onVisibility = (): void => {
    const vis = this.o.visibility;
    if (!vis || this.stopped) return;
    if (vis.visibilityState === 'hidden') {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = setTimeout(() => {
        clearTimeout(this.reconnectTimer);
        clearInterval(this.heartbeatTimer);
        this.stopPolling();
        this.setState('paused');
        this.closeSocket();
      }, this.o.hiddenDisconnectMs);
    } else {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = undefined;
      if (this.state === 'paused') {
        this.failures = 0;
        this.state = 'idle';
        this.connect();
      }
    }
  };
}
