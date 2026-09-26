/**
 * @fileoverview Small reusable React hooks.
 */

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';

/** Returns `value` after it has been stable for `ms` (search: 300 ms). */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** Whether the browser reports network connectivity. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Runs `fn` every `ms` while `ms` is not null. */
export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return undefined;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Seconds left until `until` (epoch ms), ticking every second. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), until && until > now ? 1000 : null);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
