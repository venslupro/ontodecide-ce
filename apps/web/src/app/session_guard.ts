/**
 * @fileoverview Session bootstrap used by the router guard: restores the
 * session from the refresh cookie once per page load.
 */

import {useSession} from '../entities/session/store';
import {restoreSession} from '../features/identity/api';

let pending: Promise<boolean> | null = null;

/** Resolves true when a session exists (restoring it at most once). */
export function ensureSession(): Promise<boolean> {
  const s = useSession.getState();
  if (s.status === 'authenticated') return Promise.resolve(true);
  if (s.status === 'anonymous') return Promise.resolve(false);
  pending ??= restoreSession().finally(() => {
    pending = null;
  });
  return pending;
}
