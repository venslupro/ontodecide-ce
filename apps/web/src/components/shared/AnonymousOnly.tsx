/**
 * Anonymous-only route guard.
 *
 * Ensures that the wrapped route is only visible to unauthenticated visitors.
 * Authenticated users are redirected to `/dashboard` so they never see the
 * login or signup pages while a valid session exists.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';

/**
 * Props accepted by {@link AnonymousOnly}.
 */
export interface AnonymousOnlyProps {
  /** Subtree to render when the user is not authenticated. */
  children: ReactNode;
}

/**
 * Protect a route subtree for anonymous visitors.
 *
 * @param props Children wrapped by the guard.
 * @returns Either a redirect to `/dashboard` or the wrapped children.
 */
export function AnonymousOnly({ children }: AnonymousOnlyProps) {
  const { session } = useSession();

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
