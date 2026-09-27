/**
 * @fileoverview No-domain fallback (修订说明书 4.2, ARCHITECTURE 2.1): while
 * `APP_DOMAIN` is empty the SPA lives on `ontodecide-ce.pages.dev` and this
 * Pages Function forwards every `/api/*` request to api-gateway through the
 * `GATEWAY` service binding. `_routes.json` limits Functions to `/api/*`, so
 * static assets never cost a Worker request. With a domain configured the
 * deploy publishes the SPA without `functions/` (Workers Route instead).
 *
 * The request is passed through unchanged, so cookies (`__Host-od_rt`),
 * `Origin`, `Authorization`, `X-Act-As-Tenant`, `X-Step-Up` and WebSocket
 * upgrades (`Upgrade: websocket`, `?ticket=`) all reach the gateway; the
 * gateway's response — including `Set-Cookie` and a 101 with its
 * `webSocket` — is returned as is.
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

/**
 * Proxies to the gateway unchanged (REST, cookies and WebSocket). The
 * original Request object is handed over so the upgrade and the body stream
 * are preserved; rebuilding it would drop the WebSocket pair.
 */
export const onRequest: PagesFunction<{GATEWAY: Fetcher}> = ({request, env}) =>
  env.GATEWAY.fetch(request);
