/**
 * @fileoverview Situation queries and mutations: cockpit overview (BFF),
 * alerts, acknowledgement, sample data and automation CRUD (If-Match).
 * Every key starts with `situation` so realtime increments from
 * `useSituationStream` land in the same cache.
 */

import type {JobDto} from '@ontodecide/integration/contract';
import type {PageResult} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AlertFilter,
  AutomationDef,
  AutomationDto,
} from '@ontodecide/situation/contract';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {api, apiRequest} from '../../shared/api/client';
import {isApiError} from '../../shared/api/errors';
import {qk} from '../../shared/api/query_keys';
import type {OverviewView} from './model';

/** Trend range. */
export type Range = '24h' | '7d';

/** Situation query keys (prefix `situation`). */
export const situationKeys = {
  /** 24 h is the canonical overview key the realtime stream writes to. */
  overview: (range: Range = '24h') =>
    range === '24h' ? qk.overview() : ([...qk.overview(), range] as const),
  overviewAll: () => qk.overview(),
  alerts: (f: AlertFilter & {limit?: number}) =>
    qk.alerts(f as Record<string, unknown>),
  alertsAll: () => ['situation', 'alerts'] as const,
  automations: () => ['situation', 'automations'] as const,
};

/** Object-graph keys invalidated after the sample data load. */
const OBJECT_PREFIX = ['object'] as const;

/** Cockpit overview. */
export function useOverview(range: Range) {
  return useQuery({
    queryKey: situationKeys.overview(range),
    queryFn: () =>
      api.get<OverviewView>('/situation/overview', {query: {range}}),
    staleTime: 30_000,
  });
}

/** Alerts (cursor pages of ≤ 100). */
export function useAlerts(filter: AlertFilter, limit = 50, enabled = true) {
  return useInfiniteQuery({
    queryKey: situationKeys.alerts({...filter, limit}),
    queryFn: ({pageParam}) =>
      api.get<PageResult<AlertDto>>('/alerts', {
        query: {...filter, limit, cursor: pageParam},
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    enabled,
  });
}

function patchAlertEverywhere(
  qc: QueryClient,
  id: string,
  patch: Partial<AlertDto>,
): void {
  qc.setQueriesData<OverviewView>(
    {queryKey: situationKeys.overviewAll()},
    ov =>
      ov && {
        ...ov,
        alerts: ov.alerts.map(a => (a.id === id ? {...a, ...patch} : a)),
      },
  );
}

/** Acknowledges an alert (optimistic in the overview, rolled back on error). */
export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<AlertDto>(
        `/alerts/${encodeURIComponent(id)}/acknowledgement`,
        undefined,
      ),
    onMutate: async id => {
      await qc.cancelQueries({queryKey: situationKeys.overviewAll()});
      const snapshot = qc.getQueriesData<OverviewView>({
        queryKey: situationKeys.overviewAll(),
      });
      patchAlertEverywhere(qc, id, {
        status: 'ACKED',
        ackedAt: new Date().toISOString(),
      });
      return {snapshot};
    },
    onError: (_e, _id, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({queryKey: situationKeys.alertsAll()});
    },
  });
}

/**
 * Loads a built-in example scenario once per workspace. Pass a scenario id
 * (e.g. `'supply-chain'`, `'urban-emergency'`); the workspace ontology is
 * switched to that scenario's template first.
 */
export function useLoadSample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scenarioId: string) =>
      api.post<JobDto>('/workspace/sample-data', {scenarioId}),
    onSettled: (_job, err) => {
      // Success, or CONFLICT (already loaded): the workspace has data now.
      if (err && !isApiError(err, 'CONFLICT')) return;
      void qc.invalidateQueries({queryKey: ['situation']});
      void qc.invalidateQueries({queryKey: OBJECT_PREFIX});
      void qc.invalidateQueries({queryKey: qk.me()});
    },
  });
}

// --- Automations -----------------------------------------------------------

/** Automations of the workspace. */
export function useAutomations() {
  return useQuery({
    queryKey: situationKeys.automations(),
    queryFn: async () => {
      const res = await api.get<AutomationDto[] | {items: AutomationDto[]}>(
        '/automations',
      );
      return Array.isArray(res) ? res : (res?.items ?? []);
    },
    staleTime: 30_000,
  });
}

function upsertLocal(qc: QueryClient, a: AutomationDto): void {
  qc.setQueryData<AutomationDto[]>(situationKeys.automations(), list => {
    if (!list) return [a];
    const i = list.findIndex(x => x.id === a.id);
    if (i < 0) return [...list, a];
    const next = [...list];
    next[i] = a;
    return next;
  });
}

async function withVersion(
  p: Promise<{data: AutomationDto; version: number | null}>,
): Promise<AutomationDto> {
  const {data, version} = await p;
  return version === null ? data : {...data, version};
}

/** Creates an automation. */
export function useCreateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (def: AutomationDef) =>
      withVersion(
        apiRequest<AutomationDto>('/automations', {method: 'POST', body: def}),
      ),
    onSuccess: a => upsertLocal(qc, a),
    onSettled: () =>
      void qc.invalidateQueries({queryKey: situationKeys.automations()}),
  });
}

/** Replaces an automation (If-Match = its version). */
export function useUpdateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {id: string; def: AutomationDef; version: number}) =>
      withVersion(
        apiRequest<AutomationDto>(`/automations/${encodeURIComponent(v.id)}`, {
          method: 'PUT',
          body: v.def,
          ifMatch: v.version,
        }),
      ),
    onSuccess: a => upsertLocal(qc, a),
    onSettled: () =>
      void qc.invalidateQueries({queryKey: situationKeys.automations()}),
  });
}

/** Deletes an automation (If-Match). */
export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {id: string; version: number}) =>
      api.del(`/automations/${encodeURIComponent(v.id)}`, undefined, {
        ifMatch: v.version,
      }),
    onSuccess: (_r, v) =>
      qc.setQueryData<AutomationDto[]>(situationKeys.automations(), list =>
        list?.filter(a => a.id !== v.id),
      ),
    onSettled: () =>
      void qc.invalidateQueries({queryKey: situationKeys.automations()}),
  });
}

/** Strips server fields from a stored automation. */
export function defOf(a: AutomationDto): AutomationDef {
  return {
    name: a.name,
    trigger: a.trigger,
    objectType: a.objectType,
    condition: a.condition,
    ...(a.trigger === 'schedule' ? {everyHours: a.everyHours} : {}),
    severity: a.severity,
    cooldownSec: a.cooldownSec,
    enabled: a.enabled,
  };
}
