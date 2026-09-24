/**
 * @fileoverview TanStack Query key conventions, prefixed by backend module
 * so WebSocket increments can invalidate precisely (前端详细设计 §数据结构).
 * Keys never contain the UI language.
 */

import type {Rid} from '@ontodecide/shared-kernel';

/** Alert list filter as used in query keys. */
export interface AlertKeyFilter {
  status?: string;
  severity?: string;
  rid?: string;
  limit?: number;
}

/** Query key factory. */
export const qk = {
  // situation
  overview: () => ['situation', 'overview'] as const,
  alerts: (f: AlertKeyFilter) => ['situation', 'alerts', f] as const,
  alertsAll: () => ['situation', 'alerts'] as const,
  kpis: () => ['situation', 'kpis'] as const,
  kpiTrend: (id: string, range: '24h' | '7d') =>
    ['situation', 'kpi-trend', id, range] as const,
  layout: () => ['situation', 'layout'] as const,
  automations: () => ['situation', 'automations'] as const,
  usage: () => ['situation', 'usage'] as const,
  adminUsage: () => ['situation', 'admin-usage'] as const,
  dlq: (queue?: string) => ['situation', 'dlq', queue ?? 'all'] as const,
  // object graph
  object: (rid: Rid | string) => ['object', rid] as const,
  objectsAll: () => ['object'] as const,
  objectList: (type: string, params: unknown) =>
    ['object', 'list', type, params] as const,
  objectSet: (id: string, page: string) => ['object', 'set', id, page] as const,
  objectSets: () => ['object', 'sets'] as const,
  lineage: (rid: string) => ['object', rid, 'lineage'] as const,
  actionLog: (rid: string) => ['object', rid, 'actions'] as const,
  search: (q: string, type?: string) =>
    ['object', 'search', q, type ?? ''] as const,
  impact: (rid: string, hops: number, linkTypes: readonly string[]) =>
    ['object', 'impact', rid, hops, linkTypes] as const,
  paths: (from: string, to: string) => ['object', 'paths', from, to] as const,
  // decision
  recommendation: (id: string) => ['decision', 'rec', id] as const,
  recommendations: (f: {status?: string; focus?: string}) =>
    ['decision', 'recs', f] as const,
  recommendationsAll: () => ['decision', 'recs'] as const,
  scenarios: () => ['decision', 'scenarios'] as const,
  scenario: (id: string) => ['decision', 'scenario', id] as const,
  candidates: (key: string) => ['decision', 'candidates', key] as const,
  llmQuota: () => ['decision', 'llm-quota'] as const,
  // ontology
  schema: (api: string, ver: string) => ['ontology', api, ver] as const,
  schemas: () => ['ontology', 'schemas'] as const,
  model: () => ['ontology', 'model'] as const,
  packs: () => ['ontology', 'packs'] as const,
  diff: (api: string) => ['ontology', api, 'diff'] as const,
  // integration
  sources: () => ['integration', 'sources'] as const,
  source: (id: string) => ['integration', 'source', id] as const,
  jobs: (sourceId?: string) =>
    ['integration', 'jobs', sourceId ?? 'all'] as const,
  job: (id: string) => ['integration', 'job', id] as const,
  rejected: (jobId: string) =>
    ['integration', 'job', jobId, 'rejected'] as const,
  dataHealth: () => ['integration', 'data-health'] as const,
  // identity
  me: () => ['identity', 'me'] as const,
  users: () => ['identity', 'users'] as const,
  // platform
  config: () => ['platform', 'config'] as const,
};

/** staleTime per query family (前端详细设计 表 9). */
export const STALE = {
  overview: 30_000,
  object: 60_000,
  schemaVersioned: Number.POSITIVE_INFINITY,
  model: 5 * 60_000,
  list: 30_000,
  config: 5 * 60_000,
} as const;
