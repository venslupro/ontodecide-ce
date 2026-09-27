/**
 * @fileoverview Provider assembly: QueryClient and toasts. Dark theme only
 * (no theme switching). The tooltip provider lives in the lazily loaded
 * app shell so public pages do not download Radix.
 */

import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {Toaster} from '../shared/ui/toast';

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
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
