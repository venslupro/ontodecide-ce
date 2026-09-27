/**
 * @fileoverview SPA entry: i18n, app wiring, router, render.
 */

import {RouterProvider} from '@tanstack/react-router';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {wireApp} from './app/boot';
import {Providers} from './app/providers';
import {createAppRouter} from './app/router';
import {createQueryClient} from './shared/api/query_client';
import {initI18n, resolveLanguage} from './shared/lib/i18n';
import {detectLowFrameRate} from './shared/lib/perf';
import {readPrefs} from './shared/lib/prefs';
import './styles/globals.css';

async function boot(): Promise<void> {
  const lang = resolveLanguage({
    search: location.search,
    local: readPrefs().locale,
    navigator: navigator.languages,
  });
  await initI18n({lng: lang, ns: ['common', 'auth']});

  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient);
  wireApp(queryClient, router as never);
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
