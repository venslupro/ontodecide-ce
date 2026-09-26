/**
 * @fileoverview Authenticated shell: sidebar + top bar + banners + content,
 * route-level role checks, realtime stream, and wall mode (no chrome,
 * ×1.5 font, forced dark).
 */

import {hasRole, type Role} from '@ontodecide/shared-kernel';
import {Outlet, useMatches, useRouterState} from '@tanstack/react-router';
import {useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {useSituationStream} from '../../features/situation/stream';
import {ErrorBoundary} from '../../shared/ui/error_boundary';
import {NoPermission} from '../no_permission';
import {GlobalBanners} from './banners';
import {Sidebar} from './sidebar';
import {TopBar} from './top_bar';

/** Minimum role required by the deepest matched route. */
export function useRequiredRole(): Role | undefined {
  const matches = useMatches();
  let role: Role | undefined;
  for (const m of matches) {
    const r = (m.staticData as {minRole?: Role} | undefined)?.minRole;
    if (r) role = r;
  }
  return role;
}

/** Whether the current location is cockpit wall mode. */
export function useWallMode(): boolean {
  return useRouterState({
    select: s =>
      s.location.pathname.startsWith('/cockpit') &&
      (s.location.search as {mode?: string}).mode === 'wall',
  });
}

/** App layout. */
export function AppLayout() {
  const {t} = useTranslation('common');
  const role = useSession(s => s.user?.role);
  const required = useRequiredRole();
  const wall = useWallMode();
  const pathname = useRouterState({select: s => s.location.pathname});
  useSituationStream(true);

  useEffect(() => {
    const el = document.documentElement;
    if (wall) {
      el.dataset.wall = 'true';
      el.dataset.theme = 'dark';
    } else {
      delete el.dataset.wall;
    }
    return () => {
      delete el.dataset.wall;
    };
  }, [wall]);

  const allowed = !required || (role ? hasRole([role], required) : false);
  const content = (
    <ErrorBoundary resetKey={pathname}>
      {allowed ? <Outlet /> : <NoPermission required={required!} />}
    </ErrorBoundary>
  );

  if (wall) {
    return (
      <div className="min-h-screen">
        <GlobalBanners />
        <main id="main" className="p-5">
          {content}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded focus:bg-panel-solid focus:px-3 focus:py-2"
      >
        {t('a11y.skipToContent')}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <GlobalBanners />
        <main
          id="main"
          className="mx-auto w-full max-w-[1920px] min-w-0 flex-1 p-5"
          tabIndex={-1}
        >
          {content}
        </main>
      </div>
    </div>
  );
}
