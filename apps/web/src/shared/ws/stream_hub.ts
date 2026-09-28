/**
 * @fileoverview One realtime connection per browser (前端详细设计 6.3.3).
 *
 * Tabs of the same origin viewing the same workspace elect a leader with a
 * Web Lock (`od-stream:<scope>`); only the leader opens the WebSocket and
 * re-broadcasts frames and connection state over a BroadcastChannel. When
 * the leader tab closes its lock is released and another tab takes over.
 * Every tab reports its visibility; when all tabs have been hidden for 5
 * minutes the leader disconnects, and reconnects as soon as one is visible.
 * Every tab answers a newcomer's `hello` with its visibility, and a new
 * leader asks all tabs to re-announce (`probe`), so a hand-over never
 * starts from an incomplete picture. Frames the leader produces itself
 * (e.g. polling-fallback results) fan out like WebSocket frames.
 */

import {WS_DEFAULTS, type WsFrame, type WsState} from './ws_client';

/** Minimal Web Locks surface. */
export interface LockManagerLike {
  request(name: string, cb: () => Promise<unknown>): Promise<unknown>;
}

/** Minimal BroadcastChannel surface. */
export interface ChannelLike {
  postMessage(msg: unknown): void;
  onmessage: ((ev: {data: unknown}) => void) | null;
  close(): void;
}

/** Minimal document surface for visibility. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
  removeEventListener(type: 'visibilitychange', cb: () => void): void;
}

/** The part of a WsClient the hub drives. */
export interface ClientLike {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  getState(): WsState;
}

/** Callbacks a client created by the hub must invoke. */
export interface ClientHandlers {
  onFrame(frame: WsFrame): void;
  onState(state: WsState): void;
  onEnded(): void;
}

/** Hub options. */
export interface StreamHubOptions {
  /** Workspace being viewed (own tenant or the act-as target). */
  scope: string;
  createClient(handlers: ClientHandlers): ClientLike;
  onFrame(frame: WsFrame): void;
  onState(state: WsState): void;
  onEnded(): void;
  locks?: LockManagerLike | null;
  createChannel?: ((name: string) => ChannelLike | null) | null;
  visibility?: VisibilitySource | null;
  hiddenDisconnectMs?: number;
  tabId?: string;
}

type HubMsg =
  | {t: 'frame'; frame: WsFrame}
  | {t: 'state'; state: WsState}
  | {t: 'ended'}
  | {t: 'hello'; id: string}
  | {t: 'vis'; id: string; visible: boolean}
  | {t: 'probe'; id: string}
  | {t: 'bye'; id: string};

function defaultLocks(): LockManagerLike | null {
  const l = globalThis.navigator?.locks as LockManagerLike | undefined;
  return l?.request ? l : null;
}

function defaultChannel(name: string): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(name) as unknown as ChannelLike;
}

/** Leader election + fan-out for the realtime stream. */
export class StreamHub {
  private readonly o: StreamHubOptions;
  private readonly id: string;
  private channel: ChannelLike | null = null;
  private client: ClientLike | null = null;
  private release: (() => void) | null = null;
  private leader = false;
  private stopped = true;
  private state: WsState = 'idle';
  private readonly visible = new Map<string, boolean>();
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private pausedByHub = false;

  constructor(opts: StreamHubOptions) {
    this.o = opts;
    this.id = opts.tabId ?? Math.random().toString(36).slice(2);
  }

  /** Whether this tab holds the connection. */
  isLeader(): boolean {
    return this.leader;
  }

  /** Starts (joins the election). */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const make =
      this.o.createChannel === undefined
        ? defaultChannel
        : this.o.createChannel;
    this.channel = make ? make(`od-stream:${this.o.scope}`) : null;
    if (this.channel) this.channel.onmessage = ev => this.onMessage(ev.data);
    this.o.visibility?.addEventListener('visibilitychange', this.onVisibility);
    this.visible.set(this.id, this.isVisible());
    this.post({t: 'hello', id: this.id});
    this.post({t: 'vis', id: this.id, visible: this.isVisible()});
    const locks = this.o.locks === undefined ? defaultLocks() : this.o.locks;
    if (!locks) {
      this.becomeLeader();
      return;
    }
    void locks
      .request(`od-stream:${this.o.scope}`, () => {
        if (this.stopped) return Promise.resolve();
        this.becomeLeader();
        return new Promise<void>(resolve => {
          this.release = resolve;
        });
      })
      .catch(() => {});
  }

  /** Stops and hands the connection over to another tab. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.hiddenTimer);
    this.o.visibility?.removeEventListener(
      'visibilitychange',
      this.onVisibility,
    );
    this.client?.stop();
    this.client = null;
    this.leader = false;
    this.post({t: 'bye', id: this.id});
    this.release?.();
    this.release = null;
    this.channel?.close();
    this.channel = null;
    this.visible.clear();
  }

  private isVisible(): boolean {
    return this.o.visibility
      ? this.o.visibility.visibilityState !== 'hidden'
      : true;
  }

  private post(msg: HubMsg): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel closed.
    }
  }

  private setState(s: WsState): void {
    this.state = s;
    this.o.onState(s);
  }

  private becomeLeader(): void {
    if (this.stopped || this.leader) return;
    this.leader = true;
    this.client = this.o.createClient({
      onFrame: frame => {
        this.o.onFrame(frame);
        this.post({t: 'frame', frame});
      },
      onState: state => {
        this.setState(state);
        this.post({t: 'state', state});
      },
      onEnded: () => {
        this.post({t: 'ended'});
        this.o.onEnded();
      },
    });
    // Learn the visibility of every tab that is already open.
    this.post({t: 'probe', id: this.id});
    this.client.start();
    this.checkVisibility();
  }

  private onMessage(raw: unknown): void {
    if (this.stopped) return;
    const msg = raw as HubMsg;
    switch (msg?.t) {
      case 'frame':
        if (!this.leader) this.o.onFrame(msg.frame);
        break;
      case 'state':
        if (!this.leader) this.setState(msg.state);
        break;
      case 'ended':
        if (!this.leader) this.o.onEnded();
        break;
      case 'hello':
        // Every tab introduces itself to the newcomer (it may lead later).
        if (this.leader) this.post({t: 'state', state: this.state});
        this.post({t: 'vis', id: this.id, visible: this.isVisible()});
        break;
      case 'probe':
        this.post({t: 'vis', id: this.id, visible: this.isVisible()});
        break;
      case 'vis':
        this.visible.set(msg.id, msg.visible);
        this.checkVisibility();
        break;
      case 'bye':
        this.visible.delete(msg.id);
        this.checkVisibility();
        break;
      default:
        break;
    }
  }

  private readonly onVisibility = (): void => {
    const v = this.isVisible();
    this.visible.set(this.id, v);
    this.post({t: 'vis', id: this.id, visible: v});
    this.checkVisibility();
  };

  private checkVisibility(): void {
    if (!this.leader || !this.client) return;
    const anyVisible = [...this.visible.values()].some(Boolean);
    if (anyVisible) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = undefined;
      if (this.pausedByHub) {
        this.pausedByHub = false;
        this.client.resume();
      }
      return;
    }
    if (this.hiddenTimer) return;
    this.hiddenTimer = setTimeout(() => {
      this.hiddenTimer = undefined;
      this.pausedByHub = true;
      this.client?.pause();
    }, this.o.hiddenDisconnectMs ?? WS_DEFAULTS.hiddenDisconnectMs);
  }
}
