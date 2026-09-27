/**
 * @fileoverview Decision queries and mutations: scenarios, recommendations
 * (list / one / generate) and the Owner decision (Idempotency-Key created
 * on click, optimistic status update rolled back on error). Keys start with
 * `decision`.
 */

import type {
  DecisionInput,
  GenerateInput,
  RecStatus,
  RecommendationDto,
  ScenarioDto,
  ScenarioInput,
} from '@ontodecide/decision/contract';
import type {PageResult} from '@ontodecide/shared-kernel';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import {api, apiRequest} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';

/** Decision query keys (prefix `decision`). */
export const decisionKeys = {
  rec: (id: string) => ['decision', 'rec', id] as const,
  recs: (status?: RecStatus) => ['decision', 'recs', status ?? 'all'] as const,
  recsAll: () => ['decision', 'recs'] as const,
  scenario: (id: string) => ['decision', 'scenario', id] as const,
};

/** Recommendations (optionally by status), cursor pages. */
export function useRecommendations(status?: RecStatus) {
  return useInfiniteQuery({
    queryKey: decisionKeys.recs(status),
    queryFn: ({pageParam}) =>
      api.get<PageResult<RecommendationDto>>('/recommendations', {
        query: {status, limit: 50, cursor: pageParam},
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

/** Fetches one recommendation (ETag version wins). */
export async function fetchRecommendation(
  id: string,
): Promise<RecommendationDto> {
  const res = await apiRequest<RecommendationDto>(
    `/recommendations/${encodeURIComponent(id)}`,
  );
  return {...res.data, version: res.version ?? res.data.version};
}

/** One recommendation. */
export function useRecommendation(id: string | undefined) {
  return useQuery({
    queryKey: decisionKeys.rec(id ?? ''),
    queryFn: () => fetchRecommendation(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Generates a recommendation synchronously (AI ranking ≤ 3/day). */
export function useGenerateRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateInput) =>
      api.post<RecommendationDto>('/recommendations', input),
    onSuccess: rec => {
      qc.setQueryData(decisionKeys.rec(rec.id), rec);
      void qc.invalidateQueries({queryKey: decisionKeys.recsAll()});
      void qc.invalidateQueries({queryKey: qk.me()});
      void qc.invalidateQueries({queryKey: qk.overview()});
    },
  });
}

/** Runs and stores a scenario. */
export function useRunScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScenarioInput) =>
      api.post<ScenarioDto>('/scenarios', input),
    onSuccess: s => qc.setQueryData(decisionKeys.scenario(s.id), s),
  });
}

/** One stored scenario. */
export function useScenario(id: string | undefined) {
  return useQuery({
    queryKey: decisionKeys.scenario(id ?? ''),
    queryFn: () =>
      api.get<ScenarioDto>(`/scenarios/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Decision input with the key generated when the dialog opened. */
export interface DecideInput extends DecisionInput {
  id: string;
  idempotencyKey: string;
}

type RecPages = InfiniteData<PageResult<RecommendationDto>>;

function optimisticStatus(
  qc: QueryClient,
  id: string,
  status: RecStatus,
): Array<[readonly unknown[], unknown]> {
  const saved: Array<[readonly unknown[], unknown]> = [];
  const one = qc.getQueryData<RecommendationDto>(decisionKeys.rec(id));
  saved.push([decisionKeys.rec(id), one]);
  if (one) qc.setQueryData(decisionKeys.rec(id), {...one, status});
  for (const [key, data] of qc.getQueriesData<RecPages>({
    queryKey: decisionKeys.recsAll(),
  })) {
    saved.push([key, data]);
    if (!data) continue;
    qc.setQueryData<RecPages>(key, {
      ...data,
      pages: data.pages.map(p => ({
        ...p,
        items: p.items.map(r => (r.id === id ? {...r, status} : r)),
      })),
    });
  }
  return saved;
}

/**
 * Confirms (executes ranking[0] inside the workspace, audited) or rejects
 * with a reason. The same idempotency key replays the stored result.
 */
export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: DecideInput) =>
      api.post<RecommendationDto>(
        `/recommendations/${encodeURIComponent(v.id)}/decision`,
        {decision: v.decision, ...(v.reason ? {reason: v.reason} : {})},
        {idempotencyKey: v.idempotencyKey},
      ),
    onMutate: async v => {
      await qc.cancelQueries({queryKey: ['decision']});
      return {
        saved: optimisticStatus(
          qc,
          v.id,
          v.decision === 'confirm' ? 'Confirmed' : 'Rejected',
        ),
      };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.saved ?? []) qc.setQueryData(key, data);
    },
    onSuccess: rec => qc.setQueryData(decisionKeys.rec(rec.id), rec),
    onSettled: () => {
      void qc.invalidateQueries({queryKey: decisionKeys.recsAll()});
      void qc.invalidateQueries({queryKey: qk.overview()});
      void qc.invalidateQueries({queryKey: ['object']});
    },
  });
}
