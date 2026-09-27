/**
 * @fileoverview Test render helpers: providers (fresh QueryClient, API
 * hooks, a signed-in owner by default) and a memory router so components
 * can use `Link`, `useNavigate` and `useParams/useSearch({strict: false})`.
 *
 * - `renderWithProviders(ui, {url, as, me})` renders one component.
 * - `renderApp(url, {as, me})` renders the real route tree (guards, lazy
 *   pages, layout).
 * `as`: 'owner' (default), 'admin' or 'anonymous'.
 */

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import {render, type RenderResult} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {wireApp} from '../app/boot';
import {routeTree} from '../app/router';
import {useSession, type Me} from '../entities/session/store';
import {i18n} from '../shared/lib/i18n';
import {TooltipProvider} from '../shared/ui/tooltip';
import {Toaster} from '../shared/ui/toast';
import {adminMe, adminToken, ownerMe, ownerToken} from './fixtures/platform';
import {platformDb} from './handlers/platform';

/** Who is signed in. */
export type SignedInAs = 'owner' | 'admin' | 'anonymous';

/** Options for the render helpers. */
export interface RenderOptions {
  /** Initial URL (default `/`). */
  url?: string;
  as?: SignedInAs;
  /** Overrides the `/me` of the signed-in user. */
  me?: Me;
  queryClient?: QueryClient;
  /** Legacy option (V1.3 roles); ignored, the owner is signed in. */
  user?: unknown;
}

/** Creates a QueryClient suited for tests (no retries, no gc delay). */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: {retry: false},
    },
  });
}

/**
 * Signs a fixture user into the session store (and the MSW platform db so
 * GET /me agrees).
 */
export function signIn(as: SignedInAs = 'owner', me?: Me): void {
  const s = useSession.getState();
  s.signOut();
  s.setActAs(undefined);
  if (as === 'anonymous') {
    platformDb.refresh = 'unauthenticated';
    return;
  }
  const m = me ?? (as === 'admin' ? adminMe() : ownerMe());
  platformDb.role = as;
  platformDb.me = m;
  s.setGrant({
    accessToken: as === 'admin' ? adminToken() : ownerToken(),
    expiresIn: 900,
    me: m,
  });
}

function Wrapper({qc, children}: {qc: QueryClient; children: ReactNode}) {
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** Renders `ui` inside providers and a catch-all memory router. */
export function renderWithProviders(
  ui: ReactElement,
  opts: RenderOptions = {},
): RenderResult & {queryClient: QueryClient; router: AnyRouter} {
  const qc = opts.queryClient ?? createTestQueryClient();
  const root = createRootRoute({component: Outlet});
  const any = createRoute({
    getParentRoute: () => root,
    path: '$',
    component: () => ui,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => ui,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, any]),
    history: createMemoryHistory({initialEntries: [opts.url ?? '/']}),
  }) as unknown as AnyRouter;
  wireApp(qc, router as never);
  signIn(opts.as ?? 'owner', opts.me);
  const result = render(
    <Wrapper qc={qc}>
      <RouterProvider router={router} />
    </Wrapper>,
  );
  return {...result, queryClient: qc, router};
}

/** Renders the real application route tree at `url`. */
export function renderApp(
  url: string,
  opts: Omit<RenderOptions, 'url'> = {},
): RenderResult & {queryClient: QueryClient; router: AnyRouter} {
  const qc = opts.queryClient ?? createTestQueryClient();
  const router = createRouter({
    routeTree,
    context: {queryClient: qc},
    history: createMemoryHistory({initialEntries: [url]}),
  }) as unknown as AnyRouter;
  wireApp(qc, router as never);
  signIn(opts.as ?? 'owner', opts.me);
  const result = render(
    <Wrapper qc={qc}>
      <RouterProvider router={router} />
    </Wrapper>,
  );
  return {...result, queryClient: qc, router};
}

/** Current language helper for tests. */
export function lang(): string {
  return i18n.language;
}
