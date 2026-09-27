/**
 * @fileoverview GET /me as a TanStack Query (key `['me']`, staleTime 60 s)
 * kept in sync with the session store, plus the silent session restore used
 * by the route guards.
 *
 * `/me` is always requested without `X-Act-As-Tenant`: it describes the
 * signed-in user (the admin keeps its own account while in the admin view).
 */

import {useQuery} from '@tanstack/react-query';
import {useEffect} from 'react';
import {api, refreshAccessToken} from '../../shared/api/client';
import {qk, STALE} from '../../shared/api/query_keys';
import {useSession, type Me} from './store';

/** Fetches GET /me. */
export function fetchMe(): Promise<Me> {
  return api.get<Me>('/me', {noActAs: true});
}

/** The signed-in user's account, workspace and quotas. */
export function useMe() {
  const authed = useSession(s => s.status === 'authenticated');
  const q = useQuery({
    queryKey: qk.me(),
    queryFn: fetchMe,
    enabled: authed,
    staleTime: STALE.me,
  });
  const setMe = useSession(s => s.setMe);
  useEffect(() => {
    if (q.data) setMe(q.data);
  }, [q.data, setMe]);
  return q;
}

/** Outcome of {@link restoreSession}. */
export type RestoreOutcome = 'ok' | 'expired' | 'unauthenticated';

let restoring: Promise<RestoreOutcome> | null = null;

/**
 * Ensures a session exists: silently refreshes with the HttpOnly cookie and
 * loads `/me` when the tab has no access token yet. Single-flight.
 * `expired` means the refresh answered TRIAL_EXPIRED (→ /ended).
 */
export function restoreSession(): Promise<RestoreOutcome> {
  const s = useSession.getState();
  if (s.status === 'authenticated' && s.accessToken)
    return Promise.resolve('ok');
  if (restoring) return restoring;
  restoring = (async (): Promise<RestoreOutcome> => {
    const outcome = await refreshAccessToken();
    if (outcome !== 'ok') {
      useSession.getState().signOut();
      return outcome;
    }
    try {
      useSession.getState().setMe(await fetchMe());
    } catch {
      // /me is retried by the layout query.
    }
    return 'ok';
  })().finally(() => {
    restoring = null;
  });
  return restoring;
}

/** Boolean form of {@link restoreSession}. */
export async function ensureSession(): Promise<boolean> {
  return (await restoreSession()) === 'ok';
}
