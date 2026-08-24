import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom localStorage polyfill. Some vitest + jsdom combinations expose a
 * partial localStorage that fails on .clear() / .getItem() with the
 * "--localstorage-file was provided without a valid path" warning.
 * This in-memory implementation gives tests a deterministic, full-featured
 * localStorage replacement that works regardless of how jsdom is configured.
 */
(function polyfillLocalStorage() {
  if (typeof globalThis === 'undefined') return;
  const store = new Map<string, string>();
  const impl: Storage = {
    get length() {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      const v = store.get(key);
      return v === undefined ? null : v;
    },
    key(index: number): string | null {
      const entries = Array.from(store.keys());
      return entries[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: impl,
    writable: true,
    configurable: true,
  });
})();

afterEach(cleanup);
