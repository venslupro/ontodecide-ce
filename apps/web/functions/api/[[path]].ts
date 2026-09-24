/**
 * @fileoverview Pages Function that forwards every `/api/*` request
 * (including WebSocket upgrades) to the api-gateway Worker through the
 * `GATEWAY` service binding. `_routes.json` restricts Functions to `/api/*`
 * so static assets never consume Worker requests.
 */

/** Minimal service binding shape (avoids pulling in workers-types). */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** Minimal Pages Function context. */
interface EventContext<Env> {
  request: Request;
  env: Env;
}

/** Minimal Pages Function signature. */
type PagesFunction<Env> = (
  ctx: EventContext<Env>,
) => Response | Promise<Response>;

/** Proxies to the gateway unchanged. */
export const onRequest: PagesFunction<{GATEWAY: Fetcher}> = ({request, env}) =>
  env.GATEWAY.fetch(request);
