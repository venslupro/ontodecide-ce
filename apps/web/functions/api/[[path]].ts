/**
 * @fileoverview /api/* proxy (修订说明书 4.2, ARCHITECTURE 2.1): the apex
 * domain's DNS stays with its registrar (no Cloudflare zone), so the
 * api-gateway has no Workers Route. This Pages Function forwards every
 * `/api/*` request to api-gateway through the `GATEWAY` service binding on
 * both the pages.dev host and the custom domain ontodecide-ce.<domain>.
 * `_routes.json` limits Functions to `/api/*`, so static assets never cost
 * a Worker request.
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
