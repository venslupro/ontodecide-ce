/**
 * @fileoverview `useSituationStream()`: the realtime stream wired into the
 * TanStack Query cache (前端详细设计 6.3.3 / 6.3.4).
 *
 * - One connection per browser and workspace ({@link StreamHub}); any
 *   number of components may call the hook (ref-counted).
 * - Frames are merged at most once per second inside requestAnimationFrame:
 *   KPI values overwrite by id, alerts are de-duplicated by id and inserted
 *   at the head (≤ 200), recommendations invalidate their queries, `trial`
 *   invalidates `['me']`. Everything lands under keys prefixed
 *   `['situation', …]` (plus the invalidations above), so components do
 *   not care whether data came over HTTP or WebSocket.
 * - Polling fallback (前端 6.3.3: 30 s GET /situation/overview): the leader
 *   fetches the overview and emits it as a `poll` frame, which the hub
 *   broadcasts like any frame, so follower tabs refresh too; the 24 h
 *   overview cache is replaced, the 7-day one refetched, and alert /
 *   recommendation lists are marked stale (refetched on next use).
 * - Pages may add cache mergers with {@link registerStreamMerger}.
 */

import type {QueryClient} from '@tanstack/react-query';
import {useQueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import {create} from 'zustand';
import {api} from '../api/client';
import {qk} from '../api/query_keys';
import {createFrameBatcher, type FrameBatcher} from '../lib/frame_batcher';
import {StreamHub, type StreamHubOptions} from './stream_hub';
import {WsClient, type WsFrame, type WsState} from './ws_client';

/** Synthetic frame type carrying a polled overview. */
export const POLL_FRAME = 'poll';

/** Alerts kept in the live list. */
export const LIVE_ALERTS_MAX = 200;

/** Realtime connection status (top bar badge, cockpit). */
export interface RealtimeStatus {
  state: WsState;
  /** Alert ids that arrived in the last merge (flash once). */
  newAlertIds: string[];
  /** Epoch ms of the last merged frame. */
  lastFrameAt: number | null;
  set(p: Partial<Omit<RealtimeStatus, 'set'>>): void;
}

/** Realtime status store. */
export const useRealtimeStatus = create<RealtimeStatus>(set => ({
  state: 'idle',
  newAlertIds: [],
  lastFrameAt: null,
  set: p => set(p),
}));

/** A cache merger for a batch of frames. */
export type StreamMerger = (qc: QueryClient, frames: WsFrame[]) => void;

const mergers = new Set<StreamMerger>();

/** Adds a merger (returns the unregister function). */
export function registerStreamMerger(m: StreamMerger): () => void {
  mergers.add(m);
  return () => mergers.delete(m);
}

interface WithId {
  id: string;
}

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return v && typeof v === 'object' ? [v as T] : [];
}

function hasId(v: unknown): v is WithId {
  return !!v && typeof (v as WithId).id === 'string';
}

/** Overwrites items by id (KPIs). */
export function upsertById<T extends WithId>(
  list: readonly T[] | undefined,
  items: readonly T[],
): T[] {
  const out = [...(list ?? [])];
  for (const it of items) {
    const i = out.findIndex(x => x.id === it.id);
    if (i >= 0) out[i] = {...out[i], ...it};
    else out.push(it);
  }
  return out;
}

/** Inserts new items at the head, de-duplicated by id, capped. */
export function prependById<T extends WithId>(
  list: readonly T[] | undefined,
  items: readonly T[],
  max = LIVE_ALERTS_MAX,
): T[] {
  let out = [...(list ?? [])];
  for (const it of items) {
    const i = out.findIndex(x => x.id === it.id);
    if (i >= 0) out[i] = {...out[i], ...it};
    else out = [it, ...out];
  }
  return out.slice(0, max);
}

type OverviewLike = Record<string, unknown> & {
  kpis?: WithId[];
  alerts?: WithId[];
};

/** Applies frames to an overview-like cache value (pure). */
export function mergeOverview(
  prev: OverviewLike | undefined,
  frames: readonly WsFrame[],
): OverviewLike | undefined {
  if (!prev) {
    const snap = [...frames].reverse().find(f => f.type === 'snapshot');
    return snap && snap.data && typeof snap.data === 'object'
      ? (snap.data as OverviewLike)
      : undefined;
  }
  let next: OverviewLike = prev;
  for (const f of frames) {
    if (f.type === 'snapshot' && f.data && typeof f.data === 'object') {
      next = {...next, ...(f.data as OverviewLike)};
    } else if (f.type === 'kpi') {
      next = {...next, kpis: upsertById(next.kpis, asArray<WithId>(f.data))};
    } else if (f.type === 'alert') {
      next = {
        ...next,
        alerts: prependById(next.alerts, asArray<WithId>(f.data).filter(hasId)),
      };
    }
  }
  return next;
}

/** Writes a batch of frames into the query cache. */
export function applyFrames(qc: QueryClient, frames: WsFrame[]): void {
  if (!frames.length) return;
  for (const [key, value] of qc.getQueriesData<OverviewLike>({
    queryKey: qk.overview(),
  })) {
    const next = mergeOverview(value, frames);
    if (next && next !== value) qc.setQueryData(key, next);
  }
  const alerts = frames
    .filter(f => f.type === 'alert')
    .flatMap(f => asArray<WithId>(f.data).filter(hasId));
  if (alerts.length) {
    const live = qc.getQueryData<WithId[]>(['situation', 'live-alerts']);
    qc.setQueryData(['situation', 'live-alerts'], prependById(live, alerts));
    void qc.invalidateQueries({queryKey: qk.alertsAll()});
  }
  const recs = frames.filter(f => f.type === 'recommendation');
  if (recs.length) {
    for (const f of recs) {
      for (const r of asArray<WithId>(f.data).filter(hasId))
        void qc.invalidateQueries({queryKey: qk.recommendation(r.id)});
    }
    void qc.invalidateQueries({queryKey: qk.recommendationsAll()});
  }
  const polled = [...frames].reverse().find(f => f.type === POLL_FRAME);
  if (polled && polled.data && typeof polled.data === 'object') {
    qc.setQueryData(qk.overview(), polled.data);
    void qc.invalidateQueries({queryKey: qk.overview('7d')});
    void qc.invalidateQueries({
      queryKey: qk.alertsAll(),
      refetchType: 'none',
    });
    void qc.invalidateQueries({
      queryKey: qk.recommendationsAll(),
      refetchType: 'none',
    });
  }
  if (frames.some(f => f.type === 'trial'))
    void qc.invalidateQueries({queryKey: qk.me()});
  for (const m of mergers) m(qc, frames);
  useRealtimeStatus.getState().set({
    newAlertIds: alerts.map(a => a.id),
    lastFrameAt: Date.now(),
  });
}

/**
 * One polling-fallback round: GET /situation/overview (24 h) emitted as a
 * {@link POLL_FRAME} through the hub (so followers get it as well).
 */
export async function pollOverview(emit: (f: WsFrame) => void): Promise<void> {
  const data = await api.get<unknown>('/situation/overview', {
    query: {range: '24h'},
  });
  emit({
    seq: 0,
    type: POLL_FRAME,
    data,
    occurredAt: new Date().toISOString(),
  });
}

/** Builds the same-origin stream URL for a ticket. */
export function streamUrl(ticket: string): string | null {
  if (typeof location === 'undefined') return null;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/v1/situation/stream?ticket=${encodeURIComponent(ticket)}`;
}

/** Obtains a single-use ticket and returns the URL (null on failure). */
export async function ticketUrl(): Promise<string | null> {
  const r = await api.post<{ticket: string}>('/situation/stream-tickets');
  return r?.ticket ? streamUrl(r.ticket) : null;
}

/** Global stream hooks installed by the app. */
export interface StreamConfig {
  /** Trial ended (close 4401). */
  onEnded(): void;
  /** Overrides for tests. */
  hub?: Partial<StreamHubOptions>;
  createSocket?: ConstructorParameters<typeof WsClient>[0]['createSocket'];
}

const config: StreamConfig = {onEnded: () => {}};

/** Installs app hooks. */
export function configureStream(patch: Partial<StreamConfig>): void {
  Object.assign(config, patch);
}

interface Active {
  scope: string;
  refs: number;
  hub: StreamHub;
  batcher: FrameBatcher<WsFrame>;
}

let active: Active | null = null;

function acquire(qc: QueryClient, scope: string): void {
  if (active && active.scope === scope) {
    active.refs += 1;
    return;
  }
  releaseAll();
  const batcher = createFrameBatcher<WsFrame>(
    frames => applyFrames(qc, frames),
    1000,
  );
  const status = useRealtimeStatus.getState();
  const hub = new StreamHub({
    scope,
    visibility: typeof document === 'undefined' ? null : document,
    createClient: h =>
      new WsClient({
        connectUrl: ticketUrl,
        onFrame: h.onFrame,
        onState: h.onState,
        onEnded: h.onEnded,
        createSocket: config.createSocket,
        poll: () => pollOverview(h.onFrame),
      }),
    onFrame: f => batcher.push(f),
    onState: state => status.set({state}),
    onEnded: () => config.onEnded(),
    ...config.hub,
  });
  active = {scope, refs: 1, hub, batcher};
  hub.start();
}

function release(scope: string): void {
  if (!active || active.scope !== scope) return;
  active.refs -= 1;
  if (active.refs <= 0) releaseAll();
}

/** Closes the stream (logout, trial end, leaving the admin view). */
export function releaseAll(): void {
  if (!active) return;
  active.hub.stop();
  active.batcher.dispose();
  active = null;
  useRealtimeStatus.getState().set({state: 'closed', newAlertIds: []});
}

/**
 * Subscribes to realtime increments of workspace `scope` while mounted
 * (the app layout passes the own tenant id or the act-as target). Without
 * a scope the hook only reads the shared connection state.
 */
export function useSituationStream(scope?: string | null): {
  state: WsState;
} {
  const qc = useQueryClient();
  const state = useRealtimeStatus(s => s.state);
  useEffect(() => {
    if (!scope) return undefined;
    acquire(qc, scope);
    return () => release(scope);
  }, [qc, scope]);
  return {state};
}
