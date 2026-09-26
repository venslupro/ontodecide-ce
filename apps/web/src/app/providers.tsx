/**
 * @fileoverview Provider assembly: QueryClient, tooltip provider, theme
 * application, toasts.
 */

import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import {useEffect, type ReactNode} from 'react';
import {resolveTheme, useSession} from '../entities/session/store';
import {Toaster} from '../shared/ui/toast';
import {TooltipProvider} from '../shared/ui/tooltip';

/** Applies the theme preference to `<html data-theme>` (wall mode forces dark). */
export function ThemeSync() {
  const theme = useSession(s => s.theme);
  useEffect(() => {
    const apply = () => {
      const el = document.documentElement;
      el.dataset.theme =
        el.dataset.wall === 'true' ? 'dark' : resolveTheme(theme);
    };
    apply();
    if (theme !== 'system' || typeof matchMedia === 'undefined')
      return undefined;
    const mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return null;
}

/** Wraps the app with providers. */
export function Providers({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={250}>
        <ThemeSync />
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
