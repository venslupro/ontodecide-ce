/**
 * @fileoverview TanStack Query key conventions (前端详细设计 6.2 数据结构).
 * Keys are prefixed by backend module so WebSocket increments and the admin
 * view can invalidate precisely; they never contain the UI language.
 *
 * Prefixes: `me` (account + quotas), `situation`, `object`, `decision`,
 * `ontology`, `integration`, `archive-deletion`, `admin`. Everything except
 * `admin` is business data of the current workspace (cleared when entering
 * or leaving the admin view, see {@link BUSINESS_PREFIXES}).
 */

/** Query key factory. */
export const qk = {
  // identity (GET /me: account, workspace, quotas)
  me: () => ['me'] as const,
  // situation
  overview: (range?: '24h' | '7d') =>
    range
      ? (['situation', 'overview', range] as const)
      : (['situation', 'overview'] as const),
  alerts: (f: Record<string, unknown> = {}) =>
    ['situation', 'alerts', f] as const,
  alertsAll: () => ['situation', 'alerts'] as const,
  automations: () => ['situation', 'automations'] as const,
  automation: (id: string) => ['situation', 'automation', id] as const,
  /** Realtime connection state is not a query; see shared/ws. */
  // object graph
  objectsAll: () => ['object'] as const,
  objects: (type: string, f: Record<string, unknown> = {}) =>
    ['object', 'list', type, f] as const,
  object: (rid: string) => ['object', rid] as const,
  links: (rid: string, f: Record<string, unknown> = {}) =>
    ['object', rid, 'links', f] as const,
  objectActions: (rid: string) => ['object', rid, 'actions'] as const,
  objectStats: () => ['object', 'stats'] as const,
  search: (q: string) => ['object', 'search', q] as const,
  // decision
  recommendationsAll: () => ['decision', 'recs'] as const,
  recommendations: (f: Record<string, unknown> = {}) =>
    ['decision', 'recs', f] as const,
  recommendation: (id: string) => ['decision', 'rec', id] as const,
  scenario: (id: string) => ['decision', 'scenario', id] as const,
  // ontology
  schema: () => ['ontology', 'schema'] as const,
  definitions: (kind: string) => ['ontology', kind] as const,
  definition: (kind: string, id: string) => ['ontology', kind, id] as const,
  // integration
  imports: () => ['integration', 'imports'] as const,
  import: (id: string) => ['integration', 'import', id] as const,
  // public
  archiveDeletion: (token: string) => ['archive-deletion', token] as const,
  // platform admin
  admin: (
    part:
      | 'overview'
      | 'users'
      | 'user'
      | 'archives'
      | 'settings'
      | 'audit'
      | 'blocked'
      | 'passkeys',
    f?: unknown,
  ) =>
    f === undefined
      ? (['admin', part] as const)
      : (['admin', part, f] as const),
};

/** Query key prefixes holding business data of the current workspace. */
export const BUSINESS_PREFIXES = [
  'situation',
  'object',
  'decision',
  'ontology',
  'integration',
] as const;

/** staleTime per query family (前端详细设计 表 11). */
export const STALE = {
  overview: 30_000,
  object: 60_000,
  me: 60_000,
  list: 30_000,
  admin: 60_000,
} as const;
