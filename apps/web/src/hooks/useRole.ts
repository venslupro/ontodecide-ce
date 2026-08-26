/**
 * Role helpers derived from the decoded JWT session.
 *
 * The hook exposes role predicates used by UI elements and route guards to
 * gate features based on the currently authenticated user.
 */

import { useAuthStore } from '@/store/auth';
import type { UserRole } from '@ontodecide/shared';

/**
 * Return shape of {@link useRole}.
 */
export interface UseRoleResult {
  /**
   * Check whether the current user holds the given role.
   *
   * @param role Role name to test.
   * @returns `true` if the user matches the supplied role.
   */
  hasRole: (role: UserRole) => boolean;
  /** True when the current user is an administrator. */
  isAdmin: boolean;
  /** True when the current user is a business user. */
  isUser: boolean;
}

/**
 * Read role-related predicates for the current session.
 *
 * @returns Predicates for admin and user roles plus a generic
 *   {@link UseRoleResult.hasRole | hasRole} helper.
 */
export function useRole(): UseRoleResult {
  const role = useAuthStore((state) => state.session?.role ?? null);

  const hasRole = (candidate: UserRole): boolean => role === candidate;

  return {
    hasRole,
    isAdmin: hasRole('admin'),
    isUser: hasRole('user'),
  };
}
