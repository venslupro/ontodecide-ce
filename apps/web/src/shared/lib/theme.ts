/**
 * @fileoverview Light / dark theme. The preference is "system" (follow
 * `prefers-color-scheme`, the default), "light" or "dark", stored with the
 * other local preferences. The resolved theme is written to
 * `<html data-theme>` (tokens in globals.css, charts re-read on change),
 * `color-scheme` and `<meta name="theme-color">`.
 *
 * `public/theme-init.js` applies the same logic synchronously in `<head>`
 * so the first paint already has the right theme (CSP allows no inline
 * script); keep the two in sync.
 */

import {useSyncExternalStore} from 'react';
import {readPrefs, writePrefs} from './prefs';

/** Stored preference. */
export type ThemePref = 'system' | 'light' | 'dark';

/** Resolved theme. */
export type Theme = 'light' | 'dark';

/** Preferences in display order. */
export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];

/** `theme-color` per theme (= --bg). */
const THEME_COLOR: Record<Theme, string> = {
  dark: '#070c18',
  light: '#f4f7fc',
};

const QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function isPref(v: unknown): v is ThemePref {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** The stored preference ("system" when unset or invalid). */
export function readThemePref(): ThemePref {
  const v = readPrefs().theme;
  return isPref(v) ? v : 'system';
}

/** Whether the OS asks for a dark scheme (dark when unknown). */
function systemPrefersDark(): boolean {
  try {
    return globalThis.matchMedia?.(QUERY).matches ?? true;
  } catch {
    return true;
  }
}

/** Resolves a preference against the OS setting. */
export function resolveTheme(
  pref: ThemePref,
  prefersDark = systemPrefersDark(),
): Theme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light';
  return pref;
}

/** Writes the resolved theme to the document. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme]);
}

/** Stores a preference and applies it. */
export function setThemePref(pref: ThemePref): void {
  writePrefs({theme: pref});
  applyTheme(resolveTheme(pref));
  for (const l of listeners) l();
}

/**
 * Applies the stored preference and follows OS changes while it is
 * "system". Returns the unsubscribe function.
 */
export function initTheme(): () => void {
  applyTheme(resolveTheme(readThemePref()));
  let mql: MediaQueryList | undefined;
  try {
    mql = globalThis.matchMedia?.(QUERY);
  } catch {
    mql = undefined;
  }
  if (!mql) return () => {};
  const onChange = () => {
    if (readThemePref() === 'system') applyTheme(resolveTheme('system'));
  };
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The current preference (re-renders on {@link setThemePref}). */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, readThemePref, () => 'system');
}
