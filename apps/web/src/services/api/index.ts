/**
 * Typed resource registry and module-level re-exports.
 *
 * <p>The registry mirrors the Gateway's {@code ROUTES} table 1:1, capturing
 * every URL prefix owned by a downstream service together with metadata
 * describing the client-side module that implements it and the typed
 * functions it exposes. Tests compare the registry against a hardcoded
 * prefix list so new backend routes always get a matching client module.
 *
 * <p>{@code PREFIXES_WITH_RESOURCE} is ordered from most-specific to
 * most-general so longest-prefix matching works correctly when multiple
 * prefixes overlap (e.g. {@code /api/admin/cleanup} beats
 * {@code /api/admin/}).
 */
import type { ApiError, ApiResponse } from '@ontodecide/shared';

import * as authResource from './authResource';
import * as applicationsResource from './applicationsResource';
import * as userResource from './userResource';
import * as adminUsersResource from './adminUsersResource';
import * as adminAuditResource from './adminAuditResource';
import * as adminConfigResource from './adminConfigResource';
import * as adminCleanupResource from './adminCleanupResource';
import * as ontologyResource from './ontologyResource';
import * as entitiesResource from './entitiesResource';
import * as situationResource from './situationResource';
import * as graphResource from './graphResource';
import * as ingestionResource from './ingestionResource';
import * as aiProvidersResource from './aiProvidersResource';
import * as aiScenarioResource from './aiScenarioResource';
import * as aiRecommendResource from './aiRecommendResource';
import * as aiAgentResource from './aiAgentResource';
import * as aiHistoryResource from './aiHistoryResource';

// Re-exported helpers from the transport layer so callers only need one
// import path for transport bootstrapping.
export { getApiBase, setSessionAccessor } from './client';

// Resource module re-exports (barrel).
export * as authResource from './authResource';
export * as applicationsResource from './applicationsResource';
export * as userResource from './userResource';
export * as adminUsersResource from './adminUsersResource';
export * as adminAuditResource from './adminAuditResource';
export * as adminConfigResource from './adminConfigResource';
export * as adminCleanupResource from './adminCleanupResource';
export * as ontologyResource from './ontologyResource';
export * as entitiesResource from './entitiesResource';
export * as situationResource from './situationResource';
export * as graphResource from './graphResource';
export * as ingestionResource from './ingestionResource';
export * as aiProvidersResource from './aiProvidersResource';
export * as aiScenarioResource from './aiScenarioResource';
export * as aiRecommendResource from './aiRecommendResource';
export * as aiAgentResource from './aiAgentResource';
export * as aiHistoryResource from './aiHistoryResource';

/** Stable route prefix constants (registry has exactly 16 entries). */
export const PREFIX_AUTH_LOGIN = '/api/auth/login';
export const PREFIX_AUTH_REFRESH = '/api/auth/refresh';
export const PREFIX_ADMIN_CLEANUP_STATUS =
  '/api/admin/cleanup/status/{taskId}';
export const PREFIX_ADMIN_CLEANUP = '/api/admin/cleanup';
export const PREFIX_ADMIN_USERS = '/api/admin/users';
export const PREFIX_ADMIN_AUDIT = '/api/admin/audit';
export const PREFIX_ADMIN_CONFIG = '/api/admin/config';
export const PREFIX_AUTH = '/api/auth/';
export const PREFIX_APPLICATIONS = '/api/applications';
export const PREFIX_USER = '/api/user';
export const PREFIX_GRAPH = '/api/graph';
export const PREFIX_ONTOLOGY = '/api/ontology';
export const PREFIX_ENTITIES = '/api/entities';
export const PREFIX_SITUATION = '/api/situation';
export const PREFIX_INGEST = '/api/ingest';
export const PREFIX_AI = '/api/ai/';

/**
 * Metadata descriptor for a single registered resource prefix.
 *
 * @property name Human-readable module name (matches the {@code *Resource}
 *     suffix convention, e.g. {@code "auth"} or {@code "adminUsers"}).
 * @property module Reference to the resource-module namespace object. Used
 *     by the coverage test to ensure each prefix resolves to a real file.
 * @property functions Public callable names exported from the module.
 */
export interface ResourceEntry {
  readonly name: string;
  readonly module: Readonly<Record<string, unknown>>;
  readonly functions: readonly string[];
}

/**
 * Registry type: keys are the 16 stable route-prefix constants; values are
 * the registered {@link ResourceEntry} descriptors.
 */
export type ResourceRegistry = Readonly<
  Record<
    | typeof PREFIX_AUTH_LOGIN
    | typeof PREFIX_AUTH_REFRESH
    | typeof PREFIX_ADMIN_CLEANUP_STATUS
    | typeof PREFIX_ADMIN_CLEANUP
    | typeof PREFIX_ADMIN_USERS
    | typeof PREFIX_ADMIN_AUDIT
    | typeof PREFIX_ADMIN_CONFIG
    | typeof PREFIX_AUTH
    | typeof PREFIX_APPLICATIONS
    | typeof PREFIX_USER
    | typeof PREFIX_GRAPH
    | typeof PREFIX_ONTOLOGY
    | typeof PREFIX_ENTITIES
    | typeof PREFIX_SITUATION
    | typeof PREFIX_INGEST
    | typeof PREFIX_AI,
    ResourceEntry
  >
>;

/**
 * Concrete registry singleton. Exactly 16 entries — one per client-owned
 * route prefix. Keys are ordered specific → general so
 * {@code Object.keys(RESOURCE_REGISTRY)} yields a sensible longest-match
 * order that mirrors the Gateway's {@code ROUTES} array.
 */
export const RESOURCE_REGISTRY: ResourceRegistry = {
  [PREFIX_AUTH_LOGIN]: {
    name: 'auth',
    module: authResource,
    functions: ['login'] as const,
  },
  [PREFIX_AUTH_REFRESH]: {
    name: 'auth',
    module: authResource,
    functions: ['refresh'] as const,
  },
  [PREFIX_ADMIN_CLEANUP_STATUS]: {
    name: 'adminCleanup',
    module: adminCleanupResource,
    functions: ['getStatus'] as const,
  },
  [PREFIX_ADMIN_CLEANUP]: {
    name: 'adminCleanup',
    module: adminCleanupResource,
    functions: ['trigger'] as const,
  },
  [PREFIX_ADMIN_USERS]: {
    name: 'adminUsers',
    module: adminUsersResource,
    functions: [
      'list',
      'create',
      'updateStatus',
      'resetPassword',
      'remove',
    ] as const,
  },
  [PREFIX_ADMIN_AUDIT]: {
    name: 'adminAudit',
    module: adminAuditResource,
    functions: ['list'] as const,
  },
  [PREFIX_ADMIN_CONFIG]: {
    name: 'adminConfig',
    module: adminConfigResource,
    functions: ['list', 'update'] as const,
  },
  [PREFIX_AUTH]: {
    name: 'auth',
    module: authResource,
    functions: ['login', 'refresh', 'logout', 'changePassword'] as const,
  },
  [PREFIX_APPLICATIONS]: {
    name: 'applications',
    module: applicationsResource,
    functions: ['submit'] as const,
  },
  [PREFIX_USER]: {
    name: 'user',
    module: userResource,
    functions: ['getProfile'] as const,
  },
  [PREFIX_GRAPH]: {
    name: 'graph',
    module: graphResource,
    functions: ['explore', 'cypher'] as const,
  },
  [PREFIX_ONTOLOGY]: {
    name: 'ontology',
    module: ontologyResource,
    functions: ['list', 'upsert'] as const,
  },
  [PREFIX_ENTITIES]: {
    name: 'entities',
    module: entitiesResource,
    functions: ['find', 'upsert', 'get', 'remove'] as const,
  },
  [PREFIX_SITUATION]: {
    name: 'situation',
    module: situationResource,
    functions: ['get'] as const,
  },
  [PREFIX_INGEST]: {
    name: 'ingestion',
    module: ingestionResource,
    functions: ['sync', 'file', 'webhook', 'getJob'] as const,
  },
  [PREFIX_AI]: {
    name: 'ai',
    module: {
      ...aiProvidersResource,
      ...aiScenarioResource,
      ...aiRecommendResource,
      ...aiAgentResource,
      ...aiHistoryResource,
    },
    functions: [
      'list',
      'generate',
      'plan',
      'get',
      'reflect',
    ] as const,
  },
} as const;

/**
 * Flat list of all 16 registered prefix strings, ordered longest-match
 * first (most-specific → most-general). Tests assert this list's length.
 */
export const PREFIXES_WITH_RESOURCE: readonly string[] = [
  PREFIX_AUTH_LOGIN,
  PREFIX_AUTH_REFRESH,
  PREFIX_ADMIN_CLEANUP_STATUS,
  PREFIX_ADMIN_CLEANUP,
  PREFIX_ADMIN_USERS,
  PREFIX_ADMIN_AUDIT,
  PREFIX_ADMIN_CONFIG,
  PREFIX_AUTH,
  PREFIX_APPLICATIONS,
  PREFIX_USER,
  PREFIX_GRAPH,
  PREFIX_ONTOLOGY,
  PREFIX_ENTITIES,
  PREFIX_SITUATION,
  PREFIX_INGEST,
  PREFIX_AI,
] as const;

// Silence unused-type lint for imports referenced via JSDoc/tests.
export type _ApiShapeLeak = {
  r: ApiResponse<unknown>;
  e: ApiError | undefined;
};
