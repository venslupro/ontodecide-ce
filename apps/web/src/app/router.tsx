/**
 * @fileoverview Code-based TanStack Router tree (前端详细设计 表 2 / 表 8).
 * Every page is lazily imported (one chunk per route) and preloaded on
 * intent. Public pages (/signup, /login, /ended, /archive-deletions/:token)
 * render without the app shell; /ended and /archive-deletions need no
 * token. The authenticated shell (AppLayout) is lazy too, so the public
 * pages' first load stays small. Business pages read params with
 * `strict: false` hooks.
 */

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
import {exitActAs} from '../features/admin/act_as';
import {PageLoader} from '../shared/ui/skeleton';
import {guardApp, guardPublicAuth} from './guards';
import {RouteError} from './route_error';

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

/** Search value that may have been auto-parsed as JSON (`?filter={…}`). */
function jsonStr(v: unknown): string | undefined {
  if (v && typeof v === 'object') return JSON.stringify(v);
  return str(v);
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RouteError,
  notFoundComponent: page(
    () => import('../pages/not_found_page'),
    'NotFoundPage',
  ),
});

/** /login and /signup search params. */
export interface AuthSearch {
  next?: string;
  lang?: string;
}

const authSearch = (s: Record<string, unknown>): AuthSearch => ({
  next: str(s.next),
  lang: str(s.lang),
});

const redirectSignedIn = async () => {
  const to = await guardPublicAuth();
  if (to) throw redirect({to});
};

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  validateSearch: authSearch,
  beforeLoad: redirectSignedIn,
  component: page(() => import('../pages/signup/signup_page'), 'SignupPage'),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: authSearch,
  beforeLoad: redirectSignedIn,
  component: page(() => import('../pages/login/login_page'), 'LoginPage'),
});

const endedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ended',
  validateSearch: (s: Record<string, unknown>): {lang?: string} => ({
    lang: str(s.lang),
  }),
  component: page(() => import('../pages/ended/ended_page'), 'EndedPage'),
});

const archiveDeletionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive-deletions/$token',
  component: page(
    () => import('../pages/archive-deletions/archive_deletion_page'),
    'ArchiveDeletionPage',
  ),
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({location}) => {
    const d = await guardApp(location.href);
    if (d.kind === 'login')
      throw redirect({to: '/login', search: {next: d.next}});
    if (d.kind === 'ended') throw redirect({to: '/ended'});
  },
  // Lazy: /ended and /archive-deletions must not download the app shell.
  component: page(() => import('./layouts/app_layout'), 'AppLayout'),
  errorComponent: RouteError,
  pendingComponent: PageLoader,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({to: '/cockpit'});
  },
});

const cockpitRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cockpit',
  component: page(() => import('../pages/cockpit/cockpit_page'), 'CockpitPage'),
});

/** /objects search params. */
export interface ObjectsSearch {
  type?: string;
  q?: string;
  /** JSON FilterExpr. */
  filter?: string;
  /** `prop:dir`. */
  orderBy?: string;
}

const objectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/objects',
  validateSearch: (s: Record<string, unknown>): ObjectsSearch => ({
    type: str(s.type),
    q: str(s.q),
    filter: jsonStr(s.filter),
    orderBy: str(s.orderBy),
  }),
  component: page(() => import('../pages/objects/objects_page'), 'ObjectsPage'),
});

const objectViewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/objects/$rid',
  component: page(
    () => import('../pages/object-view/object_view_page'),
    'ObjectViewPage',
  ),
});

/** /graph search params. */
export interface GraphSearch {
  rid?: string;
  depth?: number;
  /** Comma-separated link type api names. */
  linkTypes?: string;
}

const graphRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/graph',
  validateSearch: (s: Record<string, unknown>): GraphSearch => ({
    rid: str(s.rid),
    depth: num(s.depth),
    linkTypes: Array.isArray(s.linkTypes)
      ? s.linkTypes.join(',')
      : str(s.linkTypes),
  }),
  component: page(() => import('../pages/graph/graph_page'), 'GraphPage'),
});

const scenarioPage = page(
  () => import('../pages/scenarios/scenario_page'),
  'ScenarioPage',
);

const scenariosRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios',
  component: scenarioPage,
});

const scenarioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/scenarios/$id',
  component: scenarioPage,
});

const recPage = page(
  () => import('../pages/recommendations/recommendations_page'),
  'RecommendationsPage',
);

const recommendationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/recommendations',
  component: recPage,
});

const recommendationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/recommendations/$id',
  component: recPage,
});

const importsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/imports',
  component: page(() => import('../pages/imports/imports_page'), 'ImportsPage'),
});

const importNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/imports/new',
  component: page(
    () => import('../pages/imports/import_wizard_page'),
    'ImportWizardPage',
  ),
});

const importJobRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/imports/$id',
  component: page(
    () => import('../pages/imports/import_job_page'),
    'ImportJobPage',
  ),
});

const ontologyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/ontology',
  component: page(
    () => import('../pages/ontology/ontology_page'),
    'OntologyPage',
  ),
});

const automationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/automations',
  component: page(
    () => import('../pages/automations/automations_page'),
    'AutomationsPage',
  ),
});

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: page(() => import('../pages/account/account_page'), 'AccountPage'),
});

const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  // Opening the platform page leaves the admin view (back to own data).
  beforeLoad: ({context}) => exitActAs(context.queryClient),
  component: page(() => import('./admin_gate'), 'AdminGate'),
});

/** The route tree. */
export const routeTree = rootRoute.addChildren([
  signupRoute,
  loginRoute,
  endedRoute,
  archiveDeletionRoute,
  appRoute.addChildren([
    indexRoute,
    cockpitRoute,
    objectsRoute,
    objectViewRoute,
    graphRoute,
    scenariosRoute,
    scenarioRoute,
    recommendationsRoute,
    recommendationRoute,
    importsRoute,
    importNewRoute,
    importJobRoute,
    ontologyRoute,
    automationsRoute,
    accountRoute,
    adminRoute,
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
