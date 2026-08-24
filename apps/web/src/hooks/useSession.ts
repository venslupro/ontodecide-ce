/**
 * React selector hook that exposes the current auth session.
 *
 * Uses the zustand store selectors to prevent unnecessary re-renders when
 * unrelated parts of the auth state change.
 */

import { useAuthStore } from '@/store/auth';

/**
 * Return shape of {@link useSession}.
 */
export interface UseSessionResult {
  /** Access/refresh token pair or `null` when unauthenticated. */
  tokens: ReturnType<typeof useAuthStore.getState>['tokens'];
  /** Decoded JWT payload or `null` when unauthenticated. */
  session: ReturnType<typeof useAuthStore.getState>['session'];
  /** True while a store auth action is in flight. */
  loading: boolean;
  /** True when the authenticated user is an admin. */
  isAdmin: boolean;
  /** True when the user must change their password before other actions. */
  needsPasswordChange: boolean;
}

/**
 * Read the current session with granular selectors.
 *
 * @returns Session metadata along with useful derived flags.
 */
export function useSession(): UseSessionResult {
  const loading = useAuthStore((state) => state.loading);
  const tokens = useAuthStore((state) => state.tokens);
  const session = useAuthStore((state) => state.session);

  const isAdmin = session?.role === 'admin';
  const rawTokens = useAuthStore.getState().tokens as
    | { mustChangePassword?: boolean }
    | null;
  const needsPasswordChange =
    session?.pwd_change_required === true ||
    rawTokens?.mustChangePassword === true;

  return { tokens, session, loading, isAdmin, needsPasswordChange };
}
