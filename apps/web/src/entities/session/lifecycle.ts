/**
 * @fileoverview Session lifecycle events raised below the app layer (the
 * countdown, the realtime stream, the API client) and handled by the app
 * (clear tokens and caches, navigate to /ended or /login).
 */

import {refreshAccessToken} from '../../shared/api/client';
import {fetchMe} from './api';
import {useSession} from './store';

/** App-installed handlers. */
export interface LifecycleHandlers {
  /** Trial is over: clear everything and show /ended. */
  trialEnded(): void;
  /** Session is gone: clear everything and show /login?next=. */
  authFailed(): void;
}

const handlers: LifecycleHandlers = {
  trialEnded: () => {},
  authFailed: () => {},
};

/** Installs the handlers (boot). */
export function setLifecycleHandlers(p: Partial<LifecycleHandlers>): void {
  Object.assign(handlers, p);
}

/** Raises "trial ended". */
export function notifyTrialEnded(): void {
  handlers.trialEnded();
}

/** Raises "session gone". */
export function notifyAuthFailed(): void {
  handlers.authFailed();
}

/**
 * The countdown reached zero (or the stream closed with 4401): refresh once
 * — the admin may have extended the trial and the refresh endpoint signs
 * with the latest expiry — and keep going with the new `/me`; otherwise the
 * trial has ended (前端详细设计 6.3.2, V2.4 #1).
 */
export async function recheckTrial(): Promise<'extended' | 'ended'> {
  const outcome = await refreshAccessToken();
  if (outcome === 'ok') {
    try {
      const me = await fetchMe();
      useSession.getState().setMe(me);
      const texp = me.workspace.trialExpiresAt;
      if (
        !texp ||
        Date.parse(texp) > Date.now() + useSession.getState().clockSkewMs
      )
        return 'extended';
    } catch {
      // Fall through: treat as ended below.
    }
  }
  handlers.trialEnded();
  return 'ended';
}
