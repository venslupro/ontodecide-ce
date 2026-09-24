/**
 * @fileoverview Test render helpers: providers (fresh QueryClient, session
 * with a signed-in user) and a memory router so components can use `Link`.
 */

import type {UserDto} from '@ontodecide/identity/contract';
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
import {routeTree} from '../app/router';
import {useSession} from '../entities/session/store';
import {configureApi} from '../shared/api/client';
import {i18n} from '../shared/lib/i18n';
import {TooltipProvider} from '../shared/ui/tooltip';
import {Toaster} from '../shared/ui/toast';
import {adminUser} from './fixtures';

/** Options for {@link renderWithProviders}. */
export interface RenderOptions {
  /** Initial URL (default `/`). */
  url?: string;
  /** Signed-in user; `null` renders signed out. */
  user?: UserDto | null;
  queryClient?: QueryClient;
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

/** Signs a fixture user into the session store and wires API hooks. */
export function signIn(user: UserDto | null = adminUser): void {
  configureApi({
    getToken: () => useSession.getState().accessToken,
    onToken: g => useSession.getState().setGrant(g),
    getLocale: () => i18n.language,
    onAuthFailure: () => useSession.getState().signOut(),
  });
  if (user)
    useSession
      .getState()
      .setGrant({accessToken: 'token-0', expiresIn: 900, user});
  else useSession.getState().signOut();
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

/**
 * Renders `ui` inside providers and a memory router (catch-all route), so
 * `Link`, `useNavigate` and `useSearch({strict: false})` work. Await a
 * `findBy*` query before asserting.
 */
export function renderWithProviders(
  ui: ReactElement,
  opts: RenderOptions = {},
): RenderResult & {queryClient: QueryClient; router: AnyRouter} {
  signIn(opts.user === undefined ? adminUser : opts.user);
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
  const result = render(
    <Wrapper qc={qc}>
      <RouterProvider router={router} />
    </Wrapper>,
  );
  return {...result, queryClient: qc, router};
}

/**
 * Renders the real application route tree at `url` (layout, guards, lazy
 * pages). Useful for page-level tests.
 */
export function renderApp(url: string, opts: Omit<RenderOptions, 'url'> = {}) {
  signIn(opts.user === undefined ? adminUser : opts.user);
  const qc = opts.queryClient ?? createTestQueryClient();
  const router = createRouter({
    routeTree,
    context: {queryClient: qc},
    history: createMemoryHistory({initialEntries: [url]}),
  });
  const result = render(
    <Wrapper qc={qc}>
      <RouterProvider router={router} />
    </Wrapper>,
  );
  return {...result, queryClient: qc, router};
}
