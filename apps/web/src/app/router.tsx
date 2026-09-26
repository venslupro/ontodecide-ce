/**
 * @fileoverview Code-based TanStack Router tree. Every page is lazily
 * imported (one chunk per route) and preloaded on intent. Routes declare
 * `staticData.minRole`; the layout renders "no permission" when unmet and
 * the menu hides such entries.
 */

import type {Role} from '@ontodecide/shared-kernel';
import type {QueryClient} from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  type RouteComponent,
} from '@tanstack/react-router';
import {PageLoader} from '../shared/ui/skeleton';
import {AppLayout} from './layouts/app_layout';
import {RouteError} from './route_error';
import {ensureSession} from './session_guard';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    minRole?: Role;
  }
}

/** Router context. */
export interface RouterContext {
  queryClient: QueryClient;
}

/** Lazy page loader hiding module types (avoids type cycles). */
function page(loader: () => Promise<unknown>, name: string): RouteComponent {
  return lazyRouteComponent(
    loader as () => Promise<Record<string, RouteComponent>>,
    name,
  );
}

function str(v: unknown): string | undefined {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** Search value that may have been auto-parsed as JSON (e.g. `?filter={...}`). */
function jsonStr(v: unknown): string | undefined {
  if (v && typeof v === 'object') return JSON.stringify(v);
  return str(v);
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RouteError,
  notFoundComponent: page(
    () => import('../pages/not_found_page'),
    'NotFoundPage',
  ),
});

/** Login route search params. */
export interface LoginSearch {
  redirect?: string;
  lang?: string;
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): LoginSearch => ({
    redirect: str(s.redirect),
    lang: str(s.lang),
  }),
  component: page(() => import('../pages/login/login_page'), 'LoginPage'),
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({location}) => {
    const ok = await ensureSession();
    if (!ok) {
      throw redirect({
        to: '/login',
        search: {redirect: location.href, lang: undefined},
      });
    }
  },
  component: AppLayout,
  errorComponent: RouteError,
  pendingComponent: PageLoader,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({to: '/cockpit', search: {mode: undefined}});
  },
});

/** Cockpit search params. */
export interface CockpitSearch {
  mode?: 'wall';
}

const cockpitRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cockpit',
  staticData: {minRole: 'Viewer'},
  validateSearch: (s: Record<string, unknown>): CockpitSearch => ({
    mode: s.mode === 'wall' ? 'wall' : undefined,
  }),
  component: page(() => import('../pages/cockpit/cockpit_page'), 'CockpitPage'),
});

const objectsIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/objects',
  staticData: {minRole: 'Viewer'},
  component: page(
    () => import('../pages/objects/objects_index_page'),
    'ObjectsIndexPage',
  ),
});

/** Object list search params. */
export interface ObjectListSearch {
  /** JSON FilterExpr. */
  filter?: string;
  /** `prop:dir`. */
  sort?: string;
  /** Semantic / text search. */
  q?: string;
  /** Saved object set id. */
  set?: string;
}

const objectListRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/objects/$type',
  staticData: {minRole: 'Viewer'},
  validateSearch: (s: Record<string, unknown>): ObjectListSearch => ({
    filter: jsonStr(s.filter),
    sort: str(s.sort),
    q: str(s.q),
    set: str(s.set),
  }),
  component: page(
    () => import('../pages/objects/object_list_page'),
    'ObjectListPage',
  ),
});

const objectViewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/objects/rid/$rid',
  staticData: {minRole: 'Viewer'},
  component: page(
    () => import('../pages/object-view/object_view_page'),
    'ObjectViewPage',
  ),
});

/** Graph search params. */
export interface GraphSearch {
  rid?: string;
  to?: string;
  mode?: 'around' | 'paths' | 'impact';
}

const graphRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/graph',
  staticData: {minRole: 'Viewer'},
  validateSearch: (s: Record<string, unknown>): GraphSearch => ({
    rid: str(s.rid),
    to: str(s.to),
    mode:
      s.mode === 'paths' || s.mode === 'impact' || s.mode === 'around'
        ? s.mode
        : undefined,
  }),
  component: page(() => import('../pages/graph/graph_page'), 'GraphPage'),
});

const scenariosRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios',
  staticData: {minRole: 'Operator'},
  component: page(
    () => import('../pages/scenarios/scenario_list_page'),
    'ScenarioListPage',
  ),
});

/** Scenario search params (prefill from an alert / object). */
export interface ScenarioSearch {
  rid?: string;
  alertId?: string;
}

const scenarioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios/$id',
  staticData: {minRole: 'Operator'},
  validateSearch: (s: Record<string, unknown>): ScenarioSearch => ({
    rid: str(s.rid),
    alertId: str(s.alertId),
  }),
  component: page(
    () => import('../pages/scenarios/scenario_page'),
    'ScenarioPage',
  ),
});

/** Recommendation list search params. */
export interface RecListSearch {
  status?: string;
}

const recommendationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/recommendations',
  staticData: {minRole: 'Operator'},
  validateSearch: (s: Record<string, unknown>): RecListSearch => ({
    status: str(s.status),
  }),
  component: page(
    () => import('../pages/recommendations/recommendation_list_page'),
    'RecommendationListPage',
  ),
});

const recommendationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/recommendations/$id',
  staticData: {minRole: 'Operator'},
  component: page(
    () => import('../pages/recommendations/recommendation_page'),
    'RecommendationPage',
  ),
});

const sourcesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sources',
  staticData: {minRole: 'Operator'},
  component: page(
    () => import('../pages/sources/source_list_page'),
    'SourceListPage',
  ),
});

const sourceNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sources/new',
  staticData: {minRole: 'Modeler'},
  component: page(
    () => import('../pages/sources/source_wizard_page'),
    'SourceWizardPage',
  ),
});

const jobRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/jobs/$id',
  staticData: {minRole: 'Operator'},
  component: page(() => import('../pages/sources/job_page'), 'JobPage'),
});

const ontologyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/ontology',
  staticData: {minRole: 'Modeler'},
  component: page(
    () => import('../pages/ontology/ontology_index_page'),
    'OntologyIndexPage',
  ),
});

const ontologyWorkbenchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/ontology/$api',
  staticData: {minRole: 'Modeler'},
  component: page(
    () => import('../pages/ontology/ontology_workbench_page'),
    'OntologyWorkbenchPage',
  ),
});

const automationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/automations',
  staticData: {minRole: 'Operator'},
  component: page(
    () => import('../pages/automations/automations_page'),
    'AutomationsPage',
  ),
});

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  staticData: {minRole: 'Admin'},
  component: page(() => import('../pages/admin/users_page'), 'UsersPage'),
});

const healthRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/health',
  staticData: {minRole: 'Admin'},
  component: page(() => import('../pages/admin/health_page'), 'HealthPage'),
});

/** The route tree. */
export const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    cockpitRoute,
    objectsIndexRoute,
    objectListRoute,
    objectViewRoute,
    graphRoute,
    scenariosRoute,
    scenarioRoute,
    recommendationsRoute,
    recommendationRoute,
    sourcesRoute,
    sourceNewRoute,
    jobRoute,
    ontologyRoute,
    ontologyWorkbenchRoute,
    automationsRoute,
    usersRoute,
    healthRoute,
  ]),
]);

/** Creates the router. */
export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: {queryClient},
    defaultPreload: 'intent',
    defaultPendingComponent: PageLoader,
    defaultErrorComponent: RouteError,
    scrollRestoration: true,
  });
}

/** App router type. */
export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
