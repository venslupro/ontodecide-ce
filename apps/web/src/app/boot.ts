/**
 * @fileoverview Wires the lower layers to app state and navigation:
 * API client hooks (token, locale, act-as, clock skew, auth failure,
 * trial end), lifecycle handlers, the realtime stream, the account
 * language preference, and the proactive token refresh.
 */

import type {QueryClient} from '@tanstack/react-query';
import {setLifecycleHandlers} from '../entities/session/lifecycle';
import {trialKnownExpired, useSession} from '../entities/session/store';
import {configureApi, refreshAccessToken} from '../shared/api/client';
import {i18n, resolveLanguage} from '../shared/lib/i18n';
import {configureStream, releaseAll} from '../shared/ws/stream';

/** Minimal router surface needed here. */
export interface Navigator {
  navigate(opts: {to: string; search?: Record<string, unknown>}): unknown;
}

/** Skew updates smaller than this are ignored (Date has 1 s resolution). */
export const SKEW_TOLERANCE_MS = 1500;

/** Clears all client state of the session (memory token, caches, stream). */
export function clearClientState(qc: QueryClient): void {
  releaseAll();
  useSession.getState().signOut();
  qc.clear();
}

function currentHref(): string {
  return typeof location === 'undefined'
    ? '/'
    : location.pathname + location.search;
}

function onPublicPage(): boolean {
  if (typeof location === 'undefined') return false;
  return /^\/(login|signup|ended|archive-deletions)\b/.test(location.pathname);
}

/** Installs every hook; call once before rendering. */
export function wireApp(qc: QueryClient, router: Navigator): void {
  const trialEnded = () => {
    clearClientState(qc);
    void router.navigate({to: '/ended'});
  };
  const authFailed = () => {
    const was = useSession.getState().status === 'authenticated';
    clearClientState(qc);
    if (was && !onPublicPage()) {
      void router.navigate({to: '/login', search: {next: currentHref()}});
    }
  };
  setLifecycleHandlers({trialEnded, authFailed});
  configureApi({
    getToken: () => useSession.getState().accessToken,
    onToken: grant => useSession.getState().setGrant(grant),
    getLocale: () => i18n.language,
    getActAs: () => useSession.getState().actAs?.tenantId,
    trialKnownExpired,
    onTrialEnded: trialEnded,
    onAuthFailure: authFailed,
    onServerDate: serverMs => {
      const skew = serverMs - Date.now();
      const s = useSession.getState();
      if (Math.abs(skew - s.clockSkewMs) > SKEW_TOLERANCE_MS)
        s.setClockSkew(skew);
    },
  });
  configureStream({
    onEnded: () => {
      // Close 4401: re-check once (the admin may have extended the trial).
      void refreshAccessToken().then(o => {
        if (o !== 'ok') trialEnded();
      });
    },
  });

  // The account language wins over local / navigator (unless ?lang=).
  useSession.subscribe((s, prev) => {
    if (!s.me || s.me.locale === prev.me?.locale) return;
    if (prev.me) return;
    if (new URLSearchParams(location.search).get('lang')) return;
    const lang = resolveLanguage({account: s.me.locale});
    if (lang !== i18n.language) void i18n.changeLanguage(lang);
  });

  // Refresh one minute before the access token expires.
  let timer: ReturnType<typeof setTimeout> | undefined;
  useSession.subscribe((s, prev) => {
    if (s.expiresAt === prev.expiresAt) return;
    clearTimeout(timer);
    if (s.status === 'authenticated' && s.expiresAt) {
      const wait = Math.max(5_000, s.expiresAt - Date.now() - 60_000);
      timer = setTimeout(() => void refreshAccessToken(), wait);
    }
  });
}
