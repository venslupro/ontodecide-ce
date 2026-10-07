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
 * WebSocket upgrades to /situation/stream go directly to the SituationRoom
 * Durable Object (1 hop: Pages Function → DO). The ticket's `{tid}` prefix
 * selects the room; the DO redeems the single-use 30 s ticket and accepts
 * the hibernatable WebSocket. Multi-hop WebSocket proxying through service
 * bindings (Pages → GATEWAY → SITUATION → DO, or even Pages → SITUATION →
 * DO) is unreliable for the 101 upgrade, so we terminate the chain at the
 * DO. The DO already validates the ticket; Origin is checked against the
 * request host as defense in depth.
 */

/** Minimal service binding shape (avoids pulling in workers-types). */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** Minimal Durable Object namespace (idFromName + get + stub.fetch). */
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectId {
  readonly name?: string;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

/** Minimal Pages Function environment. */
interface PagesEnv {
  GATEWAY: Fetcher;
  SITUATION: Fetcher;
  SITUATION_ROOM: DurableObjectNamespace;
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

/** Path of the realtime stream endpoint. */
const STREAM_PATH = '/api/v1/situation/stream';

/**
 * Extracts the workspace id from a stream ticket (`{tid}.{random}`). The DO
 * re-validates the full ticket; here we only need the prefix to route to the
 * right room.
 */
function tidFromTicket(ticket: string | null): string | null {
  if (!ticket) return null;
  const dot = ticket.indexOf('.');
  if (dot < 0) return null;
  return ticket.slice(0, dot);
}

/**
 * Proxies to the gateway unchanged (REST, cookies). WebSocket upgrades to
 * /situation/stream go directly to the SituationRoom DO (1 hop); all other
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
    const ticket = new URL(request.url).searchParams.get('ticket');
    const tid = tidFromTicket(ticket);
    if (!tid) {
      return new Response(JSON.stringify({error: 'Invalid stream ticket'}), {
        status: 401,
        headers: {'content-type': 'application/problem+json'},
      });
    }
    const id = env.SITUATION_ROOM.idFromName(tid);
    return env.SITUATION_ROOM.get(id).fetch(request);
  }
  return env.GATEWAY.fetch(request);
};
