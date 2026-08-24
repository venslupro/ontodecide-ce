/**
 * Background token-refresh hook.
 *
 * Starts a 60-second interval that checks whether the current access token is
 * about to expire (within five minutes of `session.exp`). When so the hook
 * calls {@link AuthState.refresh | store.refresh()} to swap the refresh token
 * for a fresh access token.
 */

import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth';

const INTERVAL_MS = 60_000;
const REFRESH_WINDOW_SECONDS = 5 * 60;

/**
 * Mount a periodic token-refresh scheduler.
 *
 * The effect is safe to call in the root of any authenticated layout because
 * it self-tears down on unmount and skips the refresh when there is no active
 * session.
 */
export function useAuthRefresh(): void {
  const refresh = useAuthStore((state) => state.refresh);
  const session = useAuthStore((state) => state.session);

  useEffect(() => {
    if (!session) return undefined;

    const maybeRefresh = async (): Promise<void> => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds + REFRESH_WINDOW_SECONDS >= session.exp) {
        try {
          await refresh();
        } catch {
          // Refresh failures are handled by the store (it clears the session).
        }
      }
    };

    const timer = window.setInterval(
      () => {
        void maybeRefresh();
      },
      INTERVAL_MS,
    );

    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, session]);
}
