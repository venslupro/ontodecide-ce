/**
 * @fileoverview Situation queries & mutations: overview (BFF), alerts, KPIs,
 * cockpit layout, automations, usage and dead letters.
 */

import type {UsageResource, UsageStatus} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AlertFilter,
  AutomationDef,
  AutomationDto,
  CockpitLayout,
  DeadLetterDto,
  KpiValue,
  MetricPoint,
} from '@ontodecide/situation/contract';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useSession} from '../../entities/session/store';
import {api, asList} from '../../shared/api/client';
import {qk, STALE} from '../../shared/api/query_keys';
import type {Overview} from './model';

/** Fetches the cockpit overview and syncs usage into the session. */
export async function fetchOverview(): Promise<Overview> {
  const ov = await api.get<Overview>('/situation/overview');
  if (ov?.usage) useSession.getState().setUsage(ov.usage);
  return ov;
}

/** Cockpit overview (staleTime 30 s). */
export function useOverview(opts: {refetchInterval?: number | false} = {}) {
  return useQuery({
    queryKey: qk.overview(),
    queryFn: fetchOverview,
    staleTime: STALE.overview,
    refetchInterval: opts.refetchInterval,
  });
}

/** Alerts. */
export function useAlerts(f: AlertFilter = {}) {
  return useQuery({
    queryKey: qk.alerts({...f}),
    queryFn: async () =>
      asList(await api.get<AlertDto[]>('/alerts', {query: {...f}})),
  });
}

/** Acknowledges / closes an alert with an optimistic overview update. */
export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({id, status}: {id: string; status: 'ACKED' | 'CLOSED'}) =>
      api.patch<AlertDto>(`/alerts/${encodeURIComponent(id)}`, {status}),
    onMutate: async ({id, status}) => {
      await qc.cancelQueries({queryKey: qk.overview()});
      const prev = qc.getQueryData<Overview>(qk.overview());
      if (prev) {
        qc.setQueryData<Overview>(qk.overview(), {
          ...prev,
          alerts: prev.alerts.map(a => (a.id === id ? {...a, status} : a)),
        });
      }
      return {prev};
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.overview(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({queryKey: qk.alertsAll()});
    },
  });
}

/** KPIs. */
export function useKpis() {
  return useQuery({
    queryKey: qk.kpis(),
    queryFn: async () => asList(await api.get<KpiValue[]>('/kpis')),
  });
}

/** KPI trend. */
export function useKpiTrend(id: string | undefined, range: '24h' | '7d') {
  return useQuery({
    queryKey: qk.kpiTrend(id ?? '', range),
    queryFn: async () =>
      asList(
        await api.get<MetricPoint[]>(`/kpis/${encodeURIComponent(id!)}/trend`, {
          query: {range},
        }),
      ),
    enabled: !!id,
    staleTime: 60_000,
  });
}

/** Cockpit layout (tenant / role default). */
export function useLayout() {
  return useQuery({
    queryKey: qk.layout(),
    queryFn: () => api.get<CockpitLayout>('/cockpit/layout'),
    staleTime: 5 * 60_000,
  });
}

/** Automations. */
export function useAutomations() {
  return useQuery({
    queryKey: qk.automations(),
    queryFn: async () => asList(await api.get<AutomationDto[]>('/automations')),
  });
}

/** Creates (POST) or updates (PUT) an automation. */
export function useSaveAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (def: AutomationDef) =>
      def.id
        ? api.put<AutomationDto>(
            `/automations/${encodeURIComponent(def.id)}`,
            def,
          )
        : api.post<AutomationDto>('/automations', def),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.automations()}),
  });
}

/** Deletes an automation. */
export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del(`/automations/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.automations()}),
  });
}

/** Dry-runs a draft automation over current data. */
export function dryRunAutomation(def: AutomationDef) {
  return api.post<{wouldFire: number; sample: string[]}>(
    '/automations:dry-run',
    def,
  );
}

/** Usage status for the quota bar. */
export function useUsage() {
  return useQuery({
    queryKey: qk.usage(),
    queryFn: async () => {
      const u = await api.get<UsageStatus>('/usage');
      useSession.getState().setUsage(u);
      return u;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Admin usage (UsageGuard) with limits and degraded states. */
export interface AdminUsage extends UsageStatus {
  limits?: Partial<Record<UsageResource, number>>;
  degraded?: Record<string, boolean | string>;
}

/** Admin usage. */
export function useAdminUsage() {
  return useQuery({
    queryKey: qk.adminUsage(),
    queryFn: () => api.get<AdminUsage>('/admin/usage'),
  });
}

/** Dead letters (optionally one queue). */
export function useDeadLetters(queue?: string) {
  return useQuery({
    queryKey: qk.dlq(queue),
    queryFn: async () =>
      asList(await api.get<DeadLetterDto[]>('/admin/dlq', {query: {queue}})),
  });
}

/** Replays dead letters of a queue. */
export function useReplayDeadLetters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({queue, ids}: {queue: string; ids?: string[]}) =>
      api.post<{replayed: number}>(
        `/admin/dlq/${encodeURIComponent(queue)}/replay`,
        {ids},
      ),
    onSuccess: () => qc.invalidateQueries({queryKey: ['situation', 'dlq']}),
  });
}
