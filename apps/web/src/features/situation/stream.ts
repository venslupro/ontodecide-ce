/**
 * @fileoverview `useSituationStream`: connects the realtime WebSocket and
 * writes increments into the TanStack Query cache via a rAF-throttled merge
 * (≤ 1 render per second). Falls back to polling the overview every 30 s.
 */

import type {WsMsg} from '@ontodecide/situation/contract';
import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';
import {create} from 'zustand';
import {useSession} from '../../entities/session/store';
import {qk} from '../../shared/api/query_keys';
import {
  createFrameBatcher,
  type FrameBatcher,
} from '../../shared/lib/frame_batcher';
import {WsClient, type WsState} from '../../shared/ws/ws_client';
import {fetchOverview} from './api';
import {mergeFrames, type Overview} from './model';

/** Realtime connection status shared with the top bar / banners. */
export const useRealtimeStatus = create<{
  state: WsState;
  newAlertIds: string[];
  set(s: Partial<{state: WsState; newAlertIds: string[]}>): void;
}>(set => ({state: 'idle', newAlertIds: [], set: s => set(s)}));

/** Applies a batch of frames to the query cache. */
export function applyFrames(qc: QueryClient, frames: WsMsg[]): void {
  const prev = qc.getQueryData<Overview>(qk.overview());
  const r = mergeFrames(prev, frames);
  if (r.overview && r.overview !== prev)
    qc.setQueryData(qk.overview(), r.overview);
  if (r.usage) {
    useSession.getState().setUsage(r.usage);
    qc.setQueryData(qk.usage(), r.usage);
  }
  for (const id of r.invalidateRecs)
    void qc.invalidateQueries({queryKey: qk.recommendation(id)});
  if (r.invalidateRecs.length)
    void qc.invalidateQueries({queryKey: qk.recommendationsAll()});
  if (frames.some(f => f.type === 'alert'))
    void qc.invalidateQueries({queryKey: qk.alertsAll()});
  if (r.newAlertIds.length)
    useRealtimeStatus.getState().set({newAlertIds: r.newAlertIds});
}

/** Builds the stream URL (token in query: browsers cannot set WS headers). */
export function streamUrl(
  token: string | undefined,
  lastSeq: number,
): string | null {
  if (!token || typeof location === 'undefined') return null;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const qs = new URLSearchParams({access_token: token});
  if (lastSeq > 0) qs.set('lastSeq', String(lastSeq));
  return `${proto}//${location.host}/api/v1/situation/stream?${qs.toString()}`;
}

/** Subscribes to realtime increments while mounted. */
export function useSituationStream(enabled = true): void {
  const qc = useQueryClient();
  const authed = useSession(s => s.status === 'authenticated');
  const batcher = useRef<FrameBatcher<WsMsg> | null>(null);

  useEffect(() => {
    if (!enabled || !authed) return undefined;
    batcher.current = createFrameBatcher<WsMsg>(
      frames => applyFrames(qc, frames),
      1000,
    );
    const client = new WsClient({
      url: lastSeq => streamUrl(useSession.getState().accessToken, lastSeq),
      onFrame: f => batcher.current?.push(f as WsMsg),
      onState: state => useRealtimeStatus.getState().set({state}),
      poll: async () => {
        const ov = await fetchOverview();
        qc.setQueryData(qk.overview(), ov);
      },
      visibility: typeof document === 'undefined' ? null : document,
    });
    client.start();
    return () => {
      client.stop();
      batcher.current?.dispose();
      batcher.current = null;
      useRealtimeStatus.getState().set({state: 'idle'});
    };
  }, [enabled, authed, qc]);
}
