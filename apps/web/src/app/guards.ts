/**
 * @fileoverview Route guards (前端详细设计 表 8), evaluated in `beforeLoad`
 * from the in-memory token, the workspace status and the token role.
 *
 * | state                         | allowed                         | otherwise |
 * | no token (silent refresh fails)| /signup /login /ended /archive-deletions | /login?next= |
 * | owner, ACTIVE                 | app routes except /admin        | /admin → 403 page; /signup,/login → /cockpit |
 * | admin                         | everything incl. /admin         | — |
 * | trial over (refresh says TRIAL_EXPIRED / known past texp) | /ended | /ended |
 */

import {restoreSession, type RestoreOutcome} from '../entities/session/api';
import {trialKnownExpired, useSession} from '../entities/session/store';

/** Decision of the app-route guard. */
export type GuardDecision =
  {kind: 'allow'} | {kind: 'login'; next: string} | {kind: 'ended'};

/** Pure decision from a restore outcome (unit-tested). */
export function decideApp(
  outcome: RestoreOutcome,
  href: string,
  knownExpired: boolean,
): GuardDecision {
  if (outcome === 'ok') return knownExpired ? {kind: 'ended'} : {kind: 'allow'};
  if (outcome === 'expired' || knownExpired) return {kind: 'ended'};
  return {kind: 'login', next: href};
}

/** Guard for authenticated routes. */
export async function guardApp(href: string): Promise<GuardDecision> {
  const knownBefore = trialKnownExpired();
  const outcome = await restoreSession();
  return decideApp(
    outcome,
    href,
    outcome === 'ok' ? trialKnownExpired() : knownBefore,
  );
}

/**
 * Where a user visiting /signup or /login goes (null: stay). On a fresh page
 * load (session state still `unknown`) one silent refresh with the HttpOnly
 * cookie is tried first, so a signed-in user who opens /login in a new tab
 * lands on /cockpit. After an explicit sign-out or a failed refresh the
 * state is `anonymous` and no request is made.
 */
export async function guardPublicAuth(): Promise<string | null> {
  const s = useSession.getState();
  if (s.status === 'authenticated' && s.accessToken) return '/cockpit';
  if (s.status !== 'unknown') return null;
  return (await restoreSession()) === 'ok' ? '/cockpit' : null;
}

/** Whether the current session may open /admin. */
export function canOpenAdmin(): boolean {
  return useSession.getState().role === 'admin';
}
