/**
 * @fileoverview situation-awareness Worker entry point: SituationRpc (+
 * fetch for the WebSocket upgrade), TenantLifecycle, the SituationRoom
 * Durable Object and the domain-events consumer. The only file importing
 * `cloudflare:workers`.
 */

import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';
import type {
  CallCtx,
  DomainEventMsg,
  QueueBatch,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {
  SituationRoomApi,
  SituationRoomCore,
} from '@ontodecide/situation/application';
import type {SituationRpc as Contract} from '@ontodecide/situation/contract';
import type {SocketMeta} from '@ontodecide/situation/domain';
import type {SqlStorageLike} from '@ontodecide/situation/infrastructure';
import {
  isWebSocketUpgrade,
  problemResponse,
} from '@ontodecide/situation/interface';
import {DoRoomStorage, DoSocketHub, wrapSocket} from './durable_objects';
import type {Env} from './env';
import {type SituationService, createRoomCore, createService} from './service';

let cache: {env: Env; svc: SituationService} | undefined;
const svc = (env: Env): SituationService =>
  cache?.env === env ? cache.svc : (cache = {env, svc: createService(env)}).svc;

/** Service-binding RPC entrypoint (`entrypoint: "SituationRpc"`). */
export class SituationRpc extends WorkerEntrypoint<Env> implements Contract {
  /** WebSocket upgrade forwarded by api-gateway. */
  override fetch(request: Request): Promise<Response> {
    return svc(this.env).fetch(request);
  }
  overview(...a: Parameters<Contract['overview']>) {
    return svc(this.env).rpc.overview(...a);
  }
  listAlerts(...a: Parameters<Contract['listAlerts']>) {
    return svc(this.env).rpc.listAlerts(...a);
  }
  acknowledgeAlert(...a: Parameters<Contract['acknowledgeAlert']>) {
    return svc(this.env).rpc.acknowledgeAlert(...a);
  }
  listAutomations(...a: Parameters<Contract['listAutomations']>) {
    return svc(this.env).rpc.listAutomations(...a);
  }
  getAutomation(...a: Parameters<Contract['getAutomation']>) {
    return svc(this.env).rpc.getAutomation(...a);
  }
  createAutomation(...a: Parameters<Contract['createAutomation']>) {
    return svc(this.env).rpc.createAutomation(...a);
  }
  putAutomation(...a: Parameters<Contract['putAutomation']>) {
    return svc(this.env).rpc.putAutomation(...a);
  }
  deleteAutomation(...a: Parameters<Contract['deleteAutomation']>) {
    return svc(this.env).rpc.deleteAutomation(...a);
  }
  issueStreamTicket(...a: Parameters<Contract['issueStreamTicket']>) {
    return svc(this.env).rpc.issueStreamTicket(...a);
  }
  pushRecommendation(...a: Parameters<Contract['pushRecommendation']>) {
    return svc(this.env).rpc.pushRecommendation(...a);
  }
  resetForTemplate(...a: Parameters<Contract['resetForTemplate']>) {
    return svc(this.env).rpc.resetForTemplate(...a);
  }
}

/** Lifecycle entrypoint, bound only to identity-access. */
export class TenantLifecycle
  extends WorkerEntrypoint<Env>
  implements TenantLifecycleRpc
{
  exportTenant(tid: string, cursor: string | null) {
    return svc(this.env).lifecycle.exportTenant(tid, cursor);
  }
  purgeTenant(tid: string, maxRows: number) {
    return svc(this.env).lifecycle.purgeTenant(tid, maxRows);
  }
  countTenant(tid: string) {
    return svc(this.env).lifecycle.countTenant(tid);
  }
  closeStreams(tid: string, code: number) {
    return svc(this.env).lifecycle.closeStreams(tid, code);
  }
}

/** One room per workspace (`idFromName(tid)`); logic in SituationRoomCore. */
export class SituationRoom
  extends DurableObject<Env>
  implements SituationRoomApi
{
  private readonly core: SituationRoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = createRoomCore(env, {
      sql: ctx.storage.sql as unknown as SqlStorageLike,
      storage: new DoRoomStorage(ctx.storage),
      sockets: new DoSocketHub(ctx),
    });
    // Protocol-level heartbeat answered without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong'),
    );
  }

  overview(...a: Parameters<SituationRoomApi['overview']>) {
    return this.core.overview(...a);
  }
  listAlerts(...a: Parameters<SituationRoomApi['listAlerts']>) {
    return this.core.listAlerts(...a);
  }
  acknowledgeAlert(...a: Parameters<SituationRoomApi['acknowledgeAlert']>) {
    return this.core.acknowledgeAlert(...a);
  }
  listAutomations(ctx: CallCtx) {
    return this.core.listAutomations(ctx);
  }
  getAutomation(...a: Parameters<SituationRoomApi['getAutomation']>) {
    return this.core.getAutomation(...a);
  }
  createAutomation(...a: Parameters<SituationRoomApi['createAutomation']>) {
    return this.core.createAutomation(...a);
  }
  putAutomation(...a: Parameters<SituationRoomApi['putAutomation']>) {
    return this.core.putAutomation(...a);
  }
  deleteAutomation(...a: Parameters<SituationRoomApi['deleteAutomation']>) {
    return this.core.deleteAutomation(...a);
  }
  issueStreamTicket(ctx: CallCtx) {
    return this.core.issueStreamTicket(ctx);
  }
  pushRecommendation(...a: Parameters<SituationRoomApi['pushRecommendation']>) {
    return this.core.pushRecommendation(...a);
  }
  resetForTemplate(...a: Parameters<SituationRoomApi['resetForTemplate']>) {
    return this.core.resetForTemplate(...a);
  }
  applyEvents(tid: string, events: DomainEventMsg[]) {
    return this.core.applyEvents(tid, events);
  }
  exportTenant(tid: string) {
    return this.core.exportTenant(tid);
  }
  purgeTenant(tid: string) {
    return this.core.purgeTenant(tid);
  }
  countTenant(tid: string) {
    return this.core.countTenant(tid);
  }
  closeStreams(tid: string, code: number) {
    return this.core.closeStreams(tid, code);
  }

  /** Redeems the ticket and accepts a hibernatable WebSocket. */
  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return problemResponse('VALIDATION_FAILED', 'WebSocket upgrade required');
    }
    const ticket = new URL(request.url).searchParams.get('ticket');
    const redeemed = await this.core.redeemTicket(ticket);
    if (!redeemed) {
      return problemResponse('UNAUTHENTICATED', 'Invalid stream ticket');
    }
    const [client, server] = Object.values(new WebSocketPair());
    const meta: SocketMeta = {
      sub: redeemed.sub,
      actingAs: redeemed.actingAs,
      n: this.core.nextSocketNumber(),
    };
    this.ctx.acceptWebSocket(server, [redeemed.sub]);
    server.serializeAttachment(meta);
    await this.core.connected(wrapSocket(server));
    return new Response(null, {status: 101, webSocket: client});
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message === 'string') {
      await this.core.message(wrapSocket(ws), message);
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
  }

  override async alarm(): Promise<void> {
    await this.core.alarm();
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
  queue: (batch, env) =>
    svc(env).queue(batch as unknown as QueueBatch<unknown>),
} satisfies ExportedHandler<Env>;
