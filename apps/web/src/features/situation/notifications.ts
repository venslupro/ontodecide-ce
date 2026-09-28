/**
 * @fileoverview Top-bar notifications (效果图 c2 / c9 bell) and the sidebar
 * pending-recommendation badge.
 *
 * Sources (no extra polling): OPEN alerts (`GET /alerts?status=OPEN`, first
 * page of 20) and Proposed recommendations (`GET /recommendations?status=
 * Proposed`), both invalidated by the realtime stream, merged with whatever
 * the cockpit overview cache already holds (the polling fallback refreshes
 * that one). "Seen" is local only: ids are kept per workspace in
 * localStorage (every access in try/catch).
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import type {PageResult} from '@ontodecide/shared-kernel';
import type {AlertDto} from '@ontodecide/situation/contract';
import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {useCallback, useMemo, useSyncExternalStore} from 'react';
import {api} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';
import type {OverviewView, PendingRec} from './model';

/** Items shown in the dropdown. */
export const NOTIFICATION_LIMIT = 10;
/** Seen ids kept per workspace. */
export const SEEN_KEEP = 300;
const SEEN_PREFIX = 'od-notif-seen:';

/** One notification entry. */
export interface NotificationItem {
  kind: 'alert' | 'recommendation';
  id: string;
  title: string;
  /** ISO time (alert raisedAt / recommendation createdAt). */
  at: string;
  severity?: AlertDto['severity'];
  /** Alert object (links to its Object View). */
  rid?: string | null;
}

/** Query key of the OPEN-alert page used by the bell. */
export const openAlertsKey = () =>
  qk.alerts({status: 'OPEN', limit: 20}) as readonly unknown[];

/** Query key of the Proposed recommendations (shared with 建议中心). */
export const pendingRecsKey = () => ['decision', 'recs', 'Proposed'] as const;

// --- seen store (localStorage, per workspace) -------------------------------

const listeners = new Set<() => void>();
const memory = new Map<string, string[]>();

function readSeen(scope: string): string[] {
  const cached = memory.get(scope);
  if (cached) return cached;
  let ids: string[] = [];
  try {
    const raw = globalThis.localStorage?.getItem(SEEN_PREFIX + scope);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // Storage blocked or corrupt: nothing seen yet.
  }
  memory.set(scope, ids);
  return ids;
}

/** Marks notification ids as seen for a workspace (local only). */
export function markSeen(scope: string, ids: readonly string[]): void {
  if (!ids.length) return;
  const prev = readSeen(scope);
  const next = [...prev.filter(x => !ids.includes(x)), ...ids].slice(
    -SEEN_KEEP,
  );
  memory.set(scope, next);
  try {
    globalThis.localStorage?.setItem(SEEN_PREFIX + scope, JSON.stringify(next));
  } catch {
    // Private mode / quota: keep the in-memory copy for this tab.
  }
  for (const l of listeners) l();
}

/** Clears the in-memory copy (tests). */
export function resetSeenCache(): void {
  memory.clear();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Seen ids of a workspace (reactive). */
export function useSeen(scope: string | null): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => (scope ? readSeen(scope) : EMPTY),
    () => EMPTY,
  );
}

const EMPTY: readonly string[] = [];

// --- data --------------------------------------------------------------------

/** Merges alerts and recommendations into newest-first notifications (pure). */
export function buildNotifications(
  alerts: readonly AlertDto[],
  recs: readonly Pick<PendingRec, 'id' | 'summary' | 'createdAt' | 'status'>[],
  limit = NOTIFICATION_LIMIT,
): NotificationItem[] {
  const byId = new Map<string, NotificationItem>();
  for (const a of alerts) {
    if (a.status !== 'OPEN') continue;
    byId.set(`a:${a.id}`, {
      kind: 'alert',
      id: a.id,
      title: a.title,
      at: a.raisedAt,
      severity: a.severity,
      rid: a.rid,
    });
  }
  for (const r of recs) {
    if (r.status !== 'Proposed') continue;
    byId.set(`r:${r.id}`, {
      kind: 'recommendation',
      id: r.id,
      title: r.summary,
      at: r.createdAt,
    });
  }
  return [...byId.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

/** Stable seen-id of an item (alerts and recommendations never collide). */
export function seenId(n: Pick<NotificationItem, 'kind' | 'id'>): string {
  return `${n.kind === 'alert' ? 'a' : 'r'}:${n.id}`;
}

/** Proposed recommendations (first page), shared by the badge and the bell. */
export function usePendingRecommendations(enabled = true) {
  return useInfiniteQuery({
    queryKey: pendingRecsKey(),
    queryFn: ({pageParam}) =>
      api.get<PageResult<RecommendationDto>>('/recommendations', {
        query: {status: 'Proposed', limit: 50, cursor: pageParam},
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled,
  });
}

/** The cockpit overview cache, read without fetching it here. */
function useOverviewCache() {
  return useQuery({
    queryKey: qk.overview(),
    queryFn: () =>
      api.get<OverviewView>('/situation/overview', {query: {range: '24h'}}),
    enabled: false,
  }).data;
}

/**
 * Number of pending recommendations for the sidebar badge (the larger of
 * the Proposed list and the overview's pending list, which the polling
 * fallback keeps fresh).
 */
export function usePendingRecCount(enabled = true): number {
  const q = usePendingRecommendations(enabled);
  const ov = useOverviewCache();
  const listed = q.data?.pages[0]?.items.length ?? 0;
  const more = q.data?.pages[0]?.nextCursor ? 1 : 0;
  const fromOverview = ov?.pendingRecommendations?.length ?? 0;
  return Math.max(listed + more, fromOverview);
}

/** Bell data: latest items, unread count and the mark-as-seen actions. */
export function useNotifications(scope: string | null) {
  const enabled = !!scope;
  const alertsQ = useInfiniteQuery({
    queryKey: openAlertsKey(),
    queryFn: ({pageParam}) =>
      api.get<PageResult<AlertDto>>('/alerts', {
        query: {status: 'OPEN', limit: 20, cursor: pageParam},
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled,
  });
  const recsQ = usePendingRecommendations(enabled);
  const ov = useOverviewCache();
  const seen = useSeen(scope);

  const all = useMemo(() => {
    // The overview (stream / polling fed) wins for status changes.
    const alerts = new Map<string, AlertDto>();
    for (const a of alertsQ.data?.pages[0]?.items ?? []) alerts.set(a.id, a);
    for (const a of ov?.alerts ?? []) alerts.set(a.id, a);
    const recs = new Map<string, PendingRec>();
    for (const r of recsQ.data?.pages[0]?.items ?? []) recs.set(r.id, r);
    for (const r of ov?.pendingRecommendations ?? []) recs.set(r.id, r);
    return buildNotifications(
      [...alerts.values()],
      [...recs.values()],
      Number.POSITIVE_INFINITY,
    );
  }, [alertsQ.data, recsQ.data, ov]);
  const items = useMemo(() => all.slice(0, NOTIFICATION_LIMIT), [all]);

  const unread = all.filter(n => !seen.includes(seenId(n))).length;
  const markOne = useCallback(
    (n: NotificationItem) => scope && markSeen(scope, [seenId(n)]),
    [scope],
  );
  const markAll = useCallback(
    () => scope && markSeen(scope, all.map(seenId)),
    [scope, all],
  );
  return {
    items,
    unread,
    seen,
    markOne,
    markAll,
    isLoading: alertsQ.isLoading || recsQ.isLoading,
  };
}
