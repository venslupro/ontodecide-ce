/**
 * @fileoverview Object-graph queries and mutations: object list (cursor
 * pages, ontology-driven filter/sort), stats, one object with its version
 * (ETag), merge-patch edit with If-Match, links (≤ 2 hops), action audit
 * and action execution (Idempotency-Key + If-Match). Keys start with
 * `object`.
 */

import type {
  ActionLogDto,
  ActionResult,
  GraphSlice,
  GraphStats,
  MergePatch,
  ObjectDto,
  ObjectPage,
} from '@ontodecide/object-graph/contract';
import type {FilterExpr, OrderBy} from '@ontodecide/shared-kernel';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {api, apiRequest} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';

/** Object list parameters. */
export interface ObjectListParams {
  type?: string;
  q?: string;
  filter?: FilterExpr;
  orderBy?: OrderBy;
  limit?: number;
}

/** Object-graph query keys (prefix `object`). */
export const objectKeys = {
  all: () => ['object'] as const,
  list: (p: ObjectListParams) => ['object', 'list', p.type ?? '', p] as const,
  stats: () => ['object', 'stats'] as const,
  one: (rid: string) => ['object', rid] as const,
  links: (rid: string, depth: number, linkTypes: readonly string[]) =>
    ['object', rid, 'links', depth, linkTypes] as const,
  actions: (rid: string) => ['object', rid, 'actions'] as const,
};

/** Serializes query parameters (`filter` JSON, `orderBy=prop:dir`). */
export function objectQuery(p: ObjectListParams, cursor?: string) {
  return {
    type: p.type,
    q: p.q || undefined,
    filter: p.filter ? JSON.stringify(p.filter) : undefined,
    orderBy: p.orderBy ? `${p.orderBy.prop}:${p.orderBy.dir}` : undefined,
    limit: p.limit ?? 100,
    cursor,
  };
}

/** Objects (cursor pages of ≤ 100; ≤ 300 objects per workspace). */
export function useObjects(p: ObjectListParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: objectKeys.list(p),
    queryFn: ({pageParam, signal}) =>
      api.get<ObjectPage>('/objects', {
        query: objectQuery(p, pageParam),
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

/** Workspace object/link counts (also used before deleting a type). */
export function useObjectStats(enabled = true) {
  return useQuery({
    queryKey: objectKeys.stats(),
    queryFn: () => api.get<GraphStats>('/objects/stats'),
    staleTime: 30_000,
    enabled,
  });
}

/** Fetches one object; the ETag version is authoritative. */
export async function fetchObject(rid: string): Promise<ObjectDto> {
  const res = await apiRequest<ObjectDto>(
    `/objects/${encodeURIComponent(rid)}`,
  );
  return {...res.data, version: res.version ?? res.data.version};
}

/** One object (staleTime 60 s). */
export function useObject(rid: string | undefined) {
  return useQuery({
    queryKey: objectKeys.one(rid ?? ''),
    queryFn: () => fetchObject(rid!),
    enabled: !!rid,
    staleTime: 60_000,
  });
}

/** Merge-patches object properties with If-Match (412 on a stale version). */
export function usePatchObject(rid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {patch: MergePatch; version: number}) => {
      const res = await apiRequest<ObjectDto>(
        `/objects/${encodeURIComponent(rid)}`,
        {
          method: 'PATCH',
          body: v.patch,
          contentType: 'application/merge-patch+json',
          ifMatch: v.version,
        },
      );
      return {...res.data, version: res.version ?? res.data.version};
    },
    onSuccess: obj => {
      qc.setQueryData(objectKeys.one(rid), obj);
      void qc.invalidateQueries({queryKey: ['object', 'list']});
    },
  });
}

/** Links around an object (depth 1–2, ≤ 300 nodes). */
export function useLinks(
  rid: string | undefined,
  depth: 1 | 2,
  linkTypes: readonly string[] = [],
  limit = 300,
) {
  return useQuery({
    queryKey: objectKeys.links(rid ?? '', depth, linkTypes),
    queryFn: ({signal}) =>
      api.get<GraphSlice>(`/objects/${encodeURIComponent(rid!)}/links`, {
        query: {
          depth,
          linkTypes: linkTypes.length ? linkTypes.join(',') : undefined,
          direction: 'both',
          limit,
        },
        signal,
      }),
    enabled: !!rid,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Action audit of one object (newest first). */
export function useActionLog(rid: string | undefined) {
  return useQuery({
    queryKey: objectKeys.actions(rid ?? ''),
    queryFn: () =>
      api.get<{items: ActionLogDto[]; nextCursor: string | null}>(
        `/objects/${encodeURIComponent(rid!)}/actions`,
        {query: {limit: 50}},
      ),
    enabled: !!rid,
    staleTime: 60_000,
  });
}

/** Execute-action input. */
export interface ExecuteActionInput {
  actionType: string;
  target: string;
  params: Record<string, unknown>;
  /** Object version (If-Match). */
  version: number;
  /** Generated when the dialog opened; reused for retries. */
  idempotencyKey: string;
  recommendationId?: string;
}

/** Executes an action (Idempotency-Key + If-Match). */
export function useExecuteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ExecuteActionInput) =>
      api.post<ActionResult>(
        `/action-types/${encodeURIComponent(v.actionType)}/executions`,
        {
          target: v.target,
          params: v.params,
          ...(v.recommendationId ? {recommendationId: v.recommendationId} : {}),
        },
        {idempotencyKey: v.idempotencyKey, ifMatch: v.version},
      ),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({queryKey: objectKeys.one(v.target)});
      void qc.invalidateQueries({queryKey: objectKeys.actions(v.target)});
      void qc.invalidateQueries({queryKey: ['object', 'list']});
      void qc.invalidateQueries({queryKey: qk.overview()});
    },
  });
}
