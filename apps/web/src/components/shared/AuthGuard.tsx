/**
 * Authenticated-route guard.
 *
 * Wraps a route subtree and ensures the user is logged in before rendering
 * the children. When the user is not authenticated they are redirected to
 * `/login`, and when the user must rotate their password they are redirected
 * to `/auth/change-password`.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';

/**
 * Props accepted by {@link AuthGuard}.
 */
export interface AuthGuardProps {
  /** Subtree to render once the user passes the authentication checks. */
  children: ReactNode;
}

/**
 * Protect a route subtree for authenticated users.
 *
 * Shows a minimal loading state while the store is hydrating, redirects
 * anonymous users to the login page and forces password changes when the JWT
 * payload reports `pwd_change_required=true`.
 *
 * @param props Children wrapped by the guard.
 * @returns Either a {@link Navigate} redirect or the wrapped children.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { session, loading, needsPasswordChange } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
      >
        Loading authentication...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (needsPasswordChange && location.pathname !== '/auth/change-password') {
    return <Navigate to="/auth/change-password" replace />;
  }

  return <>{children}</>;
}
