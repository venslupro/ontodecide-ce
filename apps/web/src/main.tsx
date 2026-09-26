/**
 * @fileoverview SPA entry: i18n, API hooks, telemetry, router, render.
 */

import {RouterProvider} from '@tanstack/react-router';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Providers} from './app/providers';
import {createAppRouter} from './app/router';
import {useSession} from './entities/session/store';
import {configureApi, refreshAccessToken} from './shared/api/client';
import {createQueryClient} from './shared/api/query_client';
import {initI18n, i18n, resolveLanguage} from './shared/lib/i18n';
import {readPrefs} from './shared/lib/prefs';
import {detectLowFrameRate} from './shared/lib/perf';
import {initTelemetry} from './shared/lib/telemetry';
import './styles/globals.css';

async function boot(): Promise<void> {
  const lang = resolveLanguage({
    search: location.search,
    local: readPrefs().locale,
    navigator: navigator.languages,
  });
  await initI18n({lng: lang, ns: ['common']});
  initTelemetry(0.1);

  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient);

  configureApi({
    getToken: () => useSession.getState().accessToken,
    onToken: grant => useSession.getState().setGrant(grant),
    getLocale: () => i18n.language,
    onAuthFailure: () => {
      const wasAuthed = useSession.getState().status === 'authenticated';
      useSession.getState().signOut();
      queryClient.clear();
      if (wasAuthed && !location.pathname.startsWith('/login')) {
        void router.navigate({
          to: '/login',
          search: {
            redirect: location.pathname + location.search,
            lang: undefined,
          },
        });
      }
    },
  });

  // Account language preference wins over local/navigator (unless ?lang).
  useSession.subscribe((s, prev) => {
    if (
      s.user &&
      s.user.locale !== prev.user?.locale &&
      !new URLSearchParams(location.search).get('lang')
    ) {
      const accountLang = resolveLanguage({account: s.user.locale});
      if (prev.user === undefined && accountLang !== i18n.language)
        void i18n.changeLanguage(accountLang);
    }
  });

  // Refresh the access token one minute before it expires so the realtime
  // WebSocket (token in URL) reconnects with a valid token.
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  useSession.subscribe((s, prev) => {
    if (s.expiresAt === prev.expiresAt) return;
    clearTimeout(refreshTimer);
    if (s.status === 'authenticated' && s.expiresAt) {
      const wait = Math.max(5_000, s.expiresAt - Date.now() - 60_000);
      refreshTimer = setTimeout(() => void refreshAccessToken(), wait);
    }
  });

  detectLowFrameRate();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  );
}

void boot();
