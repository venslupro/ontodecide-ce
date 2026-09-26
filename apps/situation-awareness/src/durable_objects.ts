/**
 * @fileoverview Durable Object wrappers: SituationRoom (per tenant,
 * WebSocket Hibernation API) and UsageGuard (single instance). Logic lives
 * in the cores; these classes only delegate.
 */

import {DurableObject} from 'cloudflare:workers';
import {
  type UsageResource,
  type UsageStatus,
  createLogger,
} from '@ontodecide/shared-kernel';
import type {
  SituationRoomApi,
  UsageGuardApi,
  WsMsgType,
} from '@ontodecide/situation/application';
import type {WsMsg} from '@ontodecide/situation/contract';
import {usageThresholds} from '@ontodecide/situation/domain';
import {
  D1UsageDayRepository,
  SituationRoomCore,
  type SqlStorageLike,
  UsageGuardCore,
  parseLastSeq,
} from '@ontodecide/situation/infrastructure';
import type {Env} from './env';

/** Per-tenant realtime room. */
export class SituationRoom
  extends DurableObject<Env>
  implements SituationRoomApi
{
  private readonly core: SituationRoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new SituationRoomCore(
      ctx.storage.sql as unknown as SqlStorageLike,
      {
        broadcast: frame => {
          for (const ws of this.ctx.getWebSockets()) {
            try {
              ws.send(frame);
            } catch {
              // Socket already closing; the client resumes with lastSeq.
            }
          }
        },
      },
    );
    // Heartbeats are answered without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
  }

  publish(type: Exclude<WsMsgType, 'snapshot'>, data: unknown): Promise<WsMsg> {
    return this.core.publish(type, data);
  }

  snapshot(): Promise<WsMsg> {
    return this.core.snapshot();
  }

  since(lastSeq: number): Promise<WsMsg[] | null> {
    return this.core.since(lastSeq);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', {status: 426});
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    for (const msg of await this.core.connect(parseLastSeq(request.url))) {
      server.send(JSON.stringify(msg));
    }
    return new Response(null, {status: 101, webSocket: client});
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    for (const frame of await this.core.handleFrame(message)) {
      ws.send(JSON.stringify(frame));
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
}

/** Account-wide free-tier usage counter. */
export class UsageGuard extends DurableObject<Env> implements UsageGuardApi {
  private readonly core: UsageGuardCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const days = new D1UsageDayRepository(env.SITUATION_DB);
    this.core = new UsageGuardCore(
      ctx.storage.sql as unknown as SqlStorageLike,
      {
        thresholds: usageThresholds(env.USAGE_WARN, env.USAGE_STOP),
        onRollover: (day, used) => days.save(day, used),
        logger: createLogger({
          service: 'situation-awareness',
          do: 'UsageGuard',
        }),
      },
    );
  }

  record(batch: {resource: UsageResource; n: number}[]): Promise<UsageStatus> {
    return this.core.record(batch);
  }

  status(): Promise<UsageStatus> {
    return this.core.status();
  }
}
