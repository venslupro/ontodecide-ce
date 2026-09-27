/**
 * @fileoverview Provider assembly: QueryClient, tooltips, toasts. Dark
 * theme only (no theme switching).
 */

import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {Toaster} from '../shared/ui/toast';
import {TooltipProvider} from '../shared/ui/tooltip';

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
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
