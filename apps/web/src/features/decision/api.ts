/**
 * @fileoverview Decision queries & mutations: scenarios, candidate actions,
 * recommendations (approve with optimistic update + rollback), feedback and
 * the per-user LLM quota.
 */

import type {
  CandidateAction,
  Perturbation,
  RecStatus,
  RecommendationDto,
  ScenarioDto,
  ScenarioInput,
  ScenarioResult,
} from '@ontodecide/decision/contract';
import type {Rid} from '@ontodecide/shared-kernel';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api, asList, idempotencyKey} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';

/** Scenarios. */
export function useScenarios() {
  return useQuery({
    queryKey: qk.scenarios(),
    queryFn: async () => asList(await api.get<ScenarioDto[]>('/scenarios')),
  });
}

/** One scenario. */
export function useScenario(id: string | undefined) {
  return useQuery({
    queryKey: qk.scenario(id ?? ''),
    queryFn: () =>
      api.get<ScenarioDto>(`/scenarios/${encodeURIComponent(id!)}`),
    enabled: !!id && id !== 'new',
  });
}

/** Creates a scenario. */
export function useCreateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScenarioInput) =>
      api.post<ScenarioDto>('/scenarios', input),
    onSuccess: s => {
      qc.setQueryData(qk.scenario(s.id), s);
      void qc.invalidateQueries({queryKey: qk.scenarios()});
    },
  });
}

/** Runs a scenario (persisted when an id is given). */
export function useRunScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({id, input}: {id?: string; input: ScenarioInput}) =>
      id
        ? api.post<ScenarioResult>(
            `/scenarios/${encodeURIComponent(id)}/run`,
            input,
          )
        : api.post<ScenarioResult>('/scenarios:run', input),
    onSuccess: (_r, v) => {
      if (v.id) void qc.invalidateQueries({queryKey: qk.scenario(v.id)});
    },
  });
}

/** Candidate actions for perturbations. */
export function useCandidates(perturbations: Perturbation[]) {
  const key = JSON.stringify(perturbations);
  return useQuery({
    queryKey: qk.candidates(key),
    queryFn: async () =>
      asList(
        await api.post<CandidateAction[]>('/scenarios:candidates', {
          perturbations,
        }),
      ),
    enabled: perturbations.length > 0,
    staleTime: 60_000,
  });
}

/** Remaining LLM calls today. */
export function useLlmQuota() {
  return useQuery({
    queryKey: qk.llmQuota(),
    queryFn: () =>
      api.get<{userRemaining: number; tenantRemaining: number}>('/llm/quota'),
    staleTime: 15_000,
  });
}

/** Queues AI recommendation generation (202 → jobId = recommendation id). */
export function useGenerateRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      alertId?: string;
      scenarioId?: string;
      focus: Rid;
      locale?: string;
    }) =>
      api.post<{jobId: string}>('/recommendations:generate', req, {
        idempotencyKey: idempotencyKey('gen'),
      }),
    onSettled: () => {
      void qc.invalidateQueries({queryKey: qk.llmQuota()});
      void qc.invalidateQueries({queryKey: qk.recommendationsAll()});
    },
  });
}

/** Recommendation list filter. */
export interface RecFilter {
  status?: RecStatus;
  focus?: string;
}

/** Recommendations. */
export function useRecommendations(f: RecFilter = {}) {
  return useQuery({
    queryKey: qk.recommendations(f),
    queryFn: async () =>
      asList(
        await api.get<RecommendationDto[]>('/recommendations', {query: {...f}}),
      ),
  });
}

/** One recommendation. */
export function useRecommendation(id: string | undefined) {
  return useQuery({
    queryKey: qk.recommendation(id ?? ''),
    queryFn: () =>
      api.get<RecommendationDto>(`/recommendations/${encodeURIComponent(id!)}`),
    enabled: !!id,
    // Poll while generating (Draft) so the page fills in without WS.
    refetchInterval: q => (q.state.data?.status === 'Draft' ? 3000 : false),
  });
}

function patchRecInLists(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  patch: Partial<RecommendationDto>,
) {
  qc.setQueriesData<RecommendationDto[]>(
    {queryKey: qk.recommendationsAll()},
    list => list?.map(r => (r.id === id ? {...r, ...patch} : r)),
  );
}

/**
 * Approves & executes. Optimistically marks the recommendation `Approved`,
 * rolling back the detail and list caches on failure.
 */
export function useApprove(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<RecommendationDto>(
        `/recommendations/${encodeURIComponent(id)}/approve`,
        undefined,
        {
          idempotencyKey: `approve:${id}`,
        },
      ),
    onMutate: async () => {
      await qc.cancelQueries({queryKey: qk.recommendation(id)});
      const prev = qc.getQueryData<RecommendationDto>(qk.recommendation(id));
      const prevLists = qc.getQueriesData<RecommendationDto[]>({
        queryKey: qk.recommendationsAll(),
      });
      if (prev)
        qc.setQueryData(qk.recommendation(id), {
          ...prev,
          status: 'Approved' as RecStatus,
        });
      patchRecInLists(qc, id, {status: 'Approved'});
      return {prev, prevLists};
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.recommendation(id), ctx.prev);
      for (const [key, data] of ctx?.prevLists ?? [])
        qc.setQueryData(key, data);
    },
    onSuccess: r => {
      qc.setQueryData(qk.recommendation(id), r);
      patchRecInLists(qc, id, r);
    },
    onSettled: () => {
      void qc.invalidateQueries({queryKey: qk.recommendationsAll()});
      void qc.invalidateQueries({queryKey: qk.overview()});
    },
  });
}

/** Rejects with a mandatory reason (optimistic, with rollback). */
export function useReject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<RecommendationDto>(
        `/recommendations/${encodeURIComponent(id)}/reject`,
        {reason},
      ),
    onMutate: async reason => {
      await qc.cancelQueries({queryKey: qk.recommendation(id)});
      const prev = qc.getQueryData<RecommendationDto>(qk.recommendation(id));
      if (prev)
        qc.setQueryData(qk.recommendation(id), {
          ...prev,
          status: 'Rejected' as RecStatus,
          rejectReason: reason,
        });
      return {prev};
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.recommendation(id), ctx.prev);
    },
    onSuccess: r => qc.setQueryData(qk.recommendation(id), r),
    onSettled: () => {
      void qc.invalidateQueries({queryKey: qk.recommendationsAll()});
      void qc.invalidateQueries({queryKey: qk.overview()});
    },
  });
}

/** Rates the outcome (1–5 stars). */
export function useFeedback(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {rating: number; comment?: string}) =>
      api.post<RecommendationDto>(
        `/recommendations/${encodeURIComponent(id)}/feedback`,
        input,
      ),
    onSuccess: r => qc.setQueryData(qk.recommendation(id), r),
  });
}
