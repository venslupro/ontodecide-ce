/**
 * @fileoverview Authenticated shell: sidebar + top bar + admin-view banner
 * + global strips + content. Loads `/me`, owns the realtime connection of
 * the workspace being viewed (own tenant or the act-as target). An admin
 * who must bind a passkey first (recovery sign-in, < 2 passkeys) sees only
 * the passkey setup screen ({@link AdminSetupGate}).
 */

import {Outlet, useRouterState} from '@tanstack/react-router';
import {useTranslation} from 'react-i18next';
import {useMe} from '../../entities/session/api';
import {adminSetupNeeded, useSession} from '../../entities/session/store';
import {ErrorBoundary} from '../../shared/ui/error_boundary';
import {TooltipProvider} from '../../shared/ui/tooltip';
import {useSituationStream} from '../../shared/ws/stream';
import {AdminSetupGate} from './admin_setup_gate';
import {ActAsBanner, GlobalBanners} from './banners';
import {Sidebar} from './sidebar';
import {TopBar} from './top_bar';

/** App layout. */
export function AppLayout() {
  const {t} = useTranslation('common');
  const pathname = useRouterState({select: s => s.location.pathname});
  useMe();
  const scope = useSession(
    s => s.actAs?.tenantId ?? s.me?.workspace.tenantId ?? s.claims?.tid ?? null,
  );
  const gated = useSession(s => adminSetupNeeded(s) !== null);
  // The platform page has no realtime data (60 s refresh instead); the
  // passkey gate allows no business requests.
  useSituationStream(pathname.startsWith('/admin') || gated ? null : scope);

  return (
    <TooltipProvider delayDuration={250}>
      <AdminSetupGate>
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
            <ActAsBanner />
            <GlobalBanners />
            <main
              id="main"
              className="mx-auto w-full max-w-[1920px] min-w-0 flex-1 p-5"
              tabIndex={-1}
            >
              <ErrorBoundary resetKey={pathname}>
                <Outlet />
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </AdminSetupGate>
    </TooltipProvider>
  );
}
