/**
 * @fileoverview Object graph queries & mutations: object lists (server
 * paging), object detail, lineage, action log, object sets, search, graph
 * traversals and action execution (If-Match).
 */

import type {
  ActionLogDto,
  ActionResult,
  GraphSlice,
  LineageDto,
  ObjectDto,
  ObjectPage,
  ObjectSetDto,
} from '@ontodecide/object-graph/contract';
import type {
  FilterExpr,
  ObjectSetDef,
  OrderBy,
  Rid,
} from '@ontodecide/shared-kernel';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {useCallback} from 'react';
import {orderByParam} from '../../entities/object_set/model';
import {searchObjects} from '../../entities/renderers/object_ref_input';
import {api, asList, idempotencyKey} from '../../shared/api/client';
import {qk, STALE} from '../../shared/api/query_keys';

/** Page size bounds (前端详细设计 表 9). */
export const OBJECT_PAGE_DEFAULT = 50;
export const OBJECT_PAGE_MAX = 200;

/** List parameters. */
export interface ObjectListParams {
  filter?: FilterExpr;
  orderBy?: OrderBy;
  limit?: number;
}

/** Fetches one page of objects of a type. */
export function fetchObjectPage(
  type: string,
  p: ObjectListParams,
  cursor?: string,
  signal?: AbortSignal,
) {
  return api.get<ObjectPage>(`/objects/${encodeURIComponent(type)}`, {
    query: {
      filter: p.filter ? JSON.stringify(p.filter) : undefined,
      orderBy: orderByParam(p.orderBy),
      cursor,
      limit: Math.min(OBJECT_PAGE_MAX, p.limit ?? OBJECT_PAGE_DEFAULT),
    },
    signal,
  });
}

/** Infinite (cursor) list of objects for virtual scrolling. */
export function useObjectList(
  type: string | undefined,
  params: ObjectListParams,
) {
  return useInfiniteQuery({
    queryKey: qk.objectList(type ?? '', params),
    queryFn: ({pageParam, signal}) =>
      fetchObjectPage(type!, params, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    enabled: !!type,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Fetches an object with links (depth 1–2). */
export function fetchObject(rid: string, depth: 1 | 2) {
  return api.get<ObjectDto>(`/objects/rid/${encodeURIComponent(rid)}`, {
    query: {expand: 'links', depth},
  });
}

/** Query options for {@link useObject} (shared with imperative fetches). */
export function objectQuery(rid: string, depth: 1 | 2) {
  return {
    queryKey: [...qk.object(rid), depth] as const,
    queryFn: () => fetchObject(rid, depth),
    staleTime: STALE.object,
  };
}

/** Object detail with links (depth 1–2). */
export function useObject(rid: string | undefined, depth: 1 | 2 = 2) {
  return useQuery({
    queryKey: [...qk.object(rid ?? ''), depth] as const,
    queryFn: () => fetchObject(rid!, depth),
    enabled: !!rid,
    staleTime: STALE.object,
  });
}

/** Property lineage of an object. */
export function useLineage(rid: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.lineage(rid ?? ''),
    queryFn: () =>
      api.get<LineageDto>(`/objects/rid/${encodeURIComponent(rid!)}/lineage`),
    enabled: !!rid && enabled,
    staleTime: STALE.object,
  });
}

/** Executed actions on an object. */
export function useActionLog(rid: string | undefined) {
  return useQuery({
    queryKey: qk.actionLog(rid ?? ''),
    queryFn: async () =>
      asList(
        await api.get<ActionLogDto[]>(
          `/objects/rid/${encodeURIComponent(rid!)}/actions`,
        ),
      ),
    enabled: !!rid,
  });
}

/** Saved object sets. */
export function useObjectSets() {
  return useQuery({
    queryKey: qk.objectSets(),
    queryFn: async () => asList(await api.get<ObjectSetDto[]>('/object-sets')),
  });
}

/** Saves an object set. */
export function useSaveObjectSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {name: string; definition: ObjectSetDef}) =>
      api.post<ObjectSetDto>('/object-sets', input),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.objectSets()}),
  });
}

/** Evaluates an ad-hoc object set. */
export function evaluateObjectSet(
  def: ObjectSetDef,
  page: {cursor?: string; limit?: number} = {},
) {
  return api.post<ObjectPage>('/object-sets:evaluate', {
    definition: def,
    ...page,
  });
}

/** Evaluates a saved object set page. */
export function useSavedObjectSet(id: string | undefined, cursor = '') {
  return useQuery({
    queryKey: qk.objectSet(id ?? '', cursor),
    queryFn: () =>
      api.post<ObjectPage>(`/object-sets/${encodeURIComponent(id!)}/evaluate`, {
        cursor: cursor || undefined,
      }),
    enabled: !!id,
  });
}

/** Search objects by name / RID. */
export function useSearch(q: string, type?: string, limit = 10) {
  return useQuery({
    queryKey: qk.search(q, type),
    queryFn: () => searchObjects(q, type, limit),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  });
}

/** Impact subgraph (outgoing traversal). */
export function useImpact(
  rid: string | undefined,
  maxHops: 1 | 2 | 3,
  linkTypes: readonly string[] = [],
  limit = 200,
) {
  return useQuery({
    queryKey: qk.impact(rid ?? '', maxHops, linkTypes),
    queryFn: () =>
      api.get<GraphSlice & {degraded: boolean}>('/graph/impact', {
        query: {
          rid,
          maxHops,
          limit,
          linkTypes: linkTypes.length ? linkTypes.join(',') : undefined,
        },
      }),
    enabled: !!rid,
  });
}

/** Paths between two objects. */
export function usePaths(from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: qk.paths(from ?? '', to ?? ''),
    queryFn: () =>
      api.get<{paths: Rid[][]; degraded: boolean}>('/graph/paths', {
        query: {from, to},
      }),
    enabled: !!from && !!to,
  });
}

/** Action execution input. */
export interface ApplyActionInput {
  actionType: string;
  target: Rid;
  params: Record<string, unknown>;
  /** Object version for If-Match. */
  version?: number;
  recommendationId?: string;
}

/** Executes an action (idempotent; If-Match object version). */
export function useApplyAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: ApplyActionInput) =>
      api.post<ActionResult>(
        `/actions/${encodeURIComponent(i.actionType)}/apply`,
        {
          target: i.target,
          params: i.params,
          recommendationId: i.recommendationId,
        },
        {
          ifMatch: i.version,
          idempotencyKey: idempotencyKey(`act:${i.actionType}`),
        },
      ),
    onSuccess: r => {
      void qc.invalidateQueries({queryKey: qk.object(r.rid)});
      void qc.invalidateQueries({queryKey: ['object', 'list']});
    },
  });
}

/** Fetches one object without links. */
export function fetchObjectSummary(rid: string) {
  return api.get<ObjectDto>(`/objects/rid/${encodeURIComponent(rid)}`);
}

/**
 * Objects (without links) for a set of RIDs, e.g. to title path nodes or
 * the graph side panel. Returns a map of the loaded objects by RID.
 */
export function useObjectSummaries(rids: readonly string[]) {
  const unique = [...new Set(rids)].filter(Boolean);
  return useQueries({
    queries: unique.map(r => ({
      queryKey: [...qk.object(r), 'summary'] as const,
      queryFn: () => fetchObjectSummary(r),
      staleTime: STALE.object,
    })),
    combine: combineSummaries,
  });
}

function combineSummaries(results: {data?: ObjectDto; isLoading: boolean}[]) {
  const byRid: Record<string, ObjectDto> = {};
  results.forEach(q => {
    if (q.data) byRid[q.data.rid] = q.data;
  });
  return {byRid, isLoading: results.some(q => q.isLoading)};
}

/** Candidate objects for an action parameter's `suggest` definition (top 5). */
export function useParamSuggestions(
  defs: readonly {key: string; def: ObjectSetDef}[],
  exclude?: string,
) {
  return useQueries({
    queries: defs.map(d => ({
      queryKey: ['object', 'suggest', d.key, d.def] as const,
      queryFn: () => evaluateObjectSet(d.def, {limit: 5}),
      staleTime: 30_000,
    })),
    combine: useCallback(
      (results: {data?: ObjectPage}[]) => {
        const out: Record<string, {rid: string; title: string}[]> = {};
        results.forEach((q, i) => {
          const key = defs[i]?.key;
          if (key)
            out[key] = (q.data?.items ?? [])
              .filter(o => o.rid !== exclude)
              .map(o => ({rid: o.rid, title: o.title}));
        });
        return out;
      },
      [defs, exclude],
    ),
  });
}

/** Rebuilds the Neo4j projection (Admin). */
export function useGraphRebuild() {
  return useMutation({
    mutationFn: () => api.post<{queued: number}>('/admin/graph:rebuild'),
  });
}
