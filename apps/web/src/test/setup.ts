/**
 * @fileoverview Vitest setup: jest-dom matchers, jsdom polyfills, i18n with
 * bundled resources (zh-CN default), MSW server lifecycle.
 */

import '@testing-library/jest-dom/vitest';
import {cleanup} from '@testing-library/react';
import {afterAll, afterEach, beforeAll} from 'vitest';
import {NAMESPACES, initI18n} from '../shared/lib/i18n';
import {resetDb} from './handlers';
import {server} from './server';

// --- jsdom polyfills -------------------------------------------------------
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const g = globalThis as Record<string, unknown>;
g.ResizeObserver ??= ResizeObserverStub;
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.setPointerCapture ??= () => {};
  window.HTMLElement.prototype.scrollTo ??= function scrollTo() {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  g.requestIdleCallback ??= (cb: () => void) => setTimeout(cb, 1);
  // Canvas is unavailable: charts and graphs fall back to their aria labels.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
}

// No real network sockets in tests: the realtime client gets an inert
// WebSocket that never opens (tests drive WsClient with fakes directly).
class InertWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen: unknown = null;
  onclose: unknown = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor(public url: string) {}
  send() {}
  close() {
    this.readyState = 3;
  }
  addEventListener() {}
  removeEventListener() {}
}
g.WebSocket = InertWebSocket;

// --- i18n --------------------------------------------------------------------
const bundles = import.meta.glob<Record<string, unknown>>(
  '../locales/*/*.json',
  {eager: true, import: 'default'},
);
const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, bundle] of Object.entries(bundles)) {
  const m = /locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m) continue;
  (resources[m[1]] ??= {})[m[2]] = bundle;
}
await initI18n({lng: 'zh-CN', resources, ns: [...NAMESPACES]});

// --- MSW ---------------------------------------------------------------------
beforeAll(() => server.listen({onUnhandledRequest: 'warn'}));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDb();
});
afterAll(() => server.close());
