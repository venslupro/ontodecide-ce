/**
 * @fileoverview Frontend telemetry: web-vitals (10% sampling), errors
 * (100%) and business events (event name + object type only, never property
 * values), batched through `navigator.sendBeacon('/api/v1/telemetry')`.
 */

/** One telemetry record. */
export interface TelemetryEvent {
  kind: 'vital' | 'error' | 'event';
  name: string;
  value?: number;
  detail?: string;
  objectType?: string;
  requestId?: string;
  errorId?: string;
  path: string;
  ts: string;
  version: string;
}

const ENDPOINT = '/api/v1/telemetry';
const MAX_BYTES = 16 * 1024;
const queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sampled = false;

function base(): Pick<TelemetryEvent, 'path' | 'ts' | 'version'> {
  return {
    path: typeof location === 'undefined' ? '' : location.pathname,
    ts: new Date().toISOString(),
    version: typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__,
  };
}

/** Sends queued events now (also on page hide). */
export function flushTelemetry(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  while (queue.length) {
    const batch: TelemetryEvent[] = [];
    let bytes = 2;
    while (queue.length) {
      const size = JSON.stringify(queue[0]).length + 1;
      if (batch.length && bytes + size > MAX_BYTES) break;
      batch.push(queue.shift()!);
      bytes += size;
    }
    const body = JSON.stringify({events: batch});
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(
          ENDPOINT,
          new Blob([body], {type: 'application/json'}),
        );
      } else if (typeof fetch !== 'undefined') {
        void fetch(ENDPOINT, {
          method: 'POST',
          body,
          keepalive: true,
          headers: {'content-type': 'application/json'},
        }).catch(() => {});
      }
    } catch {
      // Telemetry must never break the app.
    }
  }
}

function enqueue(e: TelemetryEvent): void {
  queue.push(e);
  if (queue.length >= 20) flushTelemetry();
  else if (!timer) timer = setTimeout(flushTelemetry, 10_000);
}

/** Generates a short error id shown to users and sent with the report. */
export function newErrorId(): string {
  return (
    Math.random().toString(36).slice(2, 8).toUpperCase() +
    Date.now().toString(36).slice(-4).toUpperCase()
  );
}

/** Reports an error (always sent). Returns the error id. */
export function reportError(
  err: unknown,
  extra: {requestId?: string; errorId?: string} = {},
): string {
  const errorId = extra.errorId ?? newErrorId();
  const e = err instanceof Error ? err : new Error(String(err));
  enqueue({
    kind: 'error',
    name: e.name,
    detail:
      `${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`.slice(
        0,
        2000,
      ),
    requestId: extra.requestId,
    errorId,
    ...base(),
  });
  return errorId;
}

/** Records a business event (name + optional object type). */
export function track(name: string, objectType?: string): void {
  if (!sampled) return;
  enqueue({kind: 'event', name, objectType, ...base()});
}

/** Installs global error handlers and (sampled) web-vitals reporting. */
export function initTelemetry(sampleRate = 0.1): void {
  if (typeof window === 'undefined') return;
  sampled = Math.random() < sampleRate;
  window.addEventListener('error', ev => reportError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', ev => reportError(ev.reason));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTelemetry();
  });
  if (!sampled) return;
  void import('web-vitals').then(({onLCP, onINP, onCLS}) => {
    const send = (m: {name: string; value: number}) =>
      enqueue({
        kind: 'vital',
        name: m.name,
        value: Math.round(m.value * 1000) / 1000,
        ...base(),
      });
    onLCP(send);
    onINP(send);
    onCLS(send);
  });
}
