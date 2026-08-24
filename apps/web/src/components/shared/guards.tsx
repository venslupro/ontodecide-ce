/**
 * Route guard barrel. Re-exports the concrete guards wired to the auth
 * store. Keeping one import path simplifies App.tsx routing and keeps the
 * shell code stable if we ever swap the backing implementation.
 */
export { AuthGuard } from './AuthGuard';
export { AdminGuard } from './AdminGuard';
export { AnonymousOnly } from './AnonymousOnly';

import { useAuthStore } from '@/store/auth';

/**
 * Helper returning a lightweight session snapshot for use cases that don't
 * want to call {@link useAuthStore} directly or inside non-hook call sites.
 *
 * Returns the decoded JWT fields (role / username / password-change flag)
 * plus the current {@code loading} state of the auth store.
 */
export function getSessionStub(): {
  role: string | null;
  username: string | null;
  session: ReturnType<typeof useAuthStore.getState>['session'];
  loading: boolean;
  needsPasswordChange: boolean;
} {
  const state = useAuthStore.getState();
  const session = state.session;
  const tokens = state.tokens as { mustChangePassword?: boolean } | null;
  const needsPasswordChange =
    session?.pwd_change_required === true ||
    tokens?.mustChangePassword === true;
  return {
    role: session?.role ?? null,
    username: session?.username ?? null,
    session,
    loading: state.loading,
    needsPasswordChange,
  };
}
