/**
 * @fileoverview Theme preference: resolution against the OS setting,
 * `<html data-theme>` / color-scheme, persistence, and following OS
 * changes only while the preference is "system".
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readPrefs, writePrefs} from './prefs';
import {initTheme, readThemePref, resolveTheme, setThemePref} from './theme';

type Listener = () => void;

/** Installs a controllable matchMedia; returns a setter for the OS mode. */
function mockSystem(dark: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', () => mql);
  return (next: boolean) => {
    dark = next;
    for (const l of listeners) l();
  };
}

beforeEach(() => {
  writePrefs({theme: undefined});
  delete document.documentElement.dataset.theme;
});

afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('resolves system against the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('defaults to system and ignores invalid stored values', () => {
    expect(readThemePref()).toBe('system');
    writePrefs({theme: 'neon'});
    expect(readThemePref()).toBe('system');
  });

  it('follows the OS while the preference is system', () => {
    const setOs = mockSystem(false);
    const stop = initTheme();
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    setOs(true);
    expect(root.dataset.theme).toBe('dark');
    stop();
  });

  it('stores an explicit choice and stops following the OS', () => {
    const setOs = mockSystem(true);
    const stop = initTheme();
    setThemePref('light');
    expect(readPrefs().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    setOs(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    setThemePref('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
  });
});
