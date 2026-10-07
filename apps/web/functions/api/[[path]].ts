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
 *
 * WebSocket upgrades to /situation/stream bypass the gateway and go directly
 * to the SITUATION service binding (1 hop instead of 3). Multi-hop
 * WebSocket proxying through service bindings is unreliable, and the
 * situation-awareness worker already performs its own Origin check and
 * ticket validation (defense in depth), so security is not reduced.
 */

/** Minimal service binding shape (avoids pulling in workers-types). */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** Minimal Pages Function environment. */
interface PagesEnv {
  GATEWAY: Fetcher;
  SITUATION: Fetcher;
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

/** Path prefix for direct WebSocket routing to SITUATION. */
const STREAM_PATH = '/api/v1/situation/stream';

/**
 * Proxies to the gateway unchanged (REST, cookies). WebSocket upgrades to
 * /situation/stream go directly to the SITUATION service (1 hop); all other
 * requests — including the ticket endpoint — go through GATEWAY as before.
 *
 * The original Request object is handed over so the upgrade and the body
 * stream are preserved; rebuilding it would drop the WebSocket pair.
 */
export const onRequest: PagesFunction<PagesEnv> = ({request, env}) => {
  const upgrade = request.headers.get('upgrade');
  if (
    upgrade &&
    upgrade.toLowerCase() === 'websocket' &&
    new URL(request.url).pathname === STREAM_PATH
  ) {
    return env.SITUATION.fetch(request);
  }
  return env.GATEWAY.fetch(request);
};
