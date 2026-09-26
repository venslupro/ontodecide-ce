/**
 * @fileoverview Local user preferences (theme, language, sidebar). Every
 * storage access is wrapped in try/catch: private mode or disabled storage
 * falls back to in-memory defaults (前端详细设计 表 10).
 */

/** Persisted preferences. */
export interface Prefs {
  theme?: 'light' | 'dark' | 'system';
  locale?: string;
  sidebarCollapsed?: boolean;
  /** Per-type visible columns in the object table. */
  columns?: Record<string, string[]>;
}

const KEY = 'od.prefs';
let memory: Prefs = {};

/** Reads all preferences; never throws. */
export function readPrefs(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return {...memory};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Prefs) : {};
  } catch {
    return {...memory};
  }
}

/** Merges and writes preferences; never throws. */
export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = {...readPrefs(), ...patch};
  memory = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: keep the in-memory copy.
  }
  return next;
}
