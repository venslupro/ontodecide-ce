/**
 * @fileoverview Emulates a service-binding RPC stub around a plain object:
 * arguments and results are structured-cloned and thrown errors lose every
 * property except the message (as in Workers RPC).
 */

/** Wraps an RPC implementation as a binding stub. */
export function rpcBinding<T extends object>(target: T | (() => T)): T {
  const resolve = (): T =>
    typeof target === 'function' ? (target as () => T)() : target;
  return new Proxy({} as T, {
    get(_obj, prop) {
      if (prop === 'then') return undefined;
      return async (...args: unknown[]) => {
        const impl = resolve() as Record<string | symbol, unknown>;
        const fn = impl[prop];
        if (typeof fn !== 'function')
          throw new Error(`RPC method not found: ${String(prop)}`);
        let result: unknown;
        try {
          result = await (fn as (...a: unknown[]) => unknown).apply(
            impl,
            structuredClone(args),
          );
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : String(e));
        }
        return result === undefined ? undefined : structuredClone(result);
      };
    },
  });
}

/** Wraps a fetch handler as a Fetcher binding (merged with an RPC stub if given). */
export function fetcherBinding<T extends object>(
  fetchHandler: (req: Request) => Promise<Response>,
  rpc?: T,
): T & Fetcher {
  const stub = rpc ? rpcBinding(rpc) : ({} as T);
  return new Proxy(stub as T & Fetcher, {
    get(obj, prop) {
      if (prop === 'fetch') {
        return (input: RequestInfo, init?: RequestInit) =>
          fetchHandler(
            input instanceof Request ? input : new Request(input, init),
          );
      }
      return (obj as Record<string | symbol, unknown>)[prop];
    },
  });
}
