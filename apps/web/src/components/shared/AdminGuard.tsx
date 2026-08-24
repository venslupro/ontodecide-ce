/**
 * Admin-only route guard.
 *
 * Renders the wrapped children only when the authenticated user is an admin;
 * otherwise redirects to `/401`. A minimal loading state is shown while the
 * auth store is hydrating.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';

/**
 * Props accepted by {@link AdminGuard}.
 */
export interface AdminGuardProps {
  /** Subtree to render for admin users. */
  children: ReactNode;
}

/**
 * Protect a route subtree for administrator users.
 *
 * @param props Children wrapped by the guard.
 * @returns Either a redirect to `/401` or the wrapped children.
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
      >
        Loading...
      </div>
    );
  }

  if (!session || session.role !== 'admin') {
    return <Navigate to="/401" replace />;
  }

  return <>{children}</>;
}
