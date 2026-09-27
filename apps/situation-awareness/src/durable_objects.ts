/**
 * @fileoverview Runtime adapters of the SituationRoom Durable Object:
 * storage / alarm and hibernatable WebSockets behind the application ports.
 * Uses only runtime types, so it imports cleanly in Node.
 */

import type {
  RoomSocket,
  RoomStorage,
  SocketHub,
} from '@ontodecide/situation/application';
import type {SocketMeta} from '@ontodecide/situation/domain';

/** RoomStorage over DurableObjectStorage. */
export class DoRoomStorage implements RoomStorage {
  constructor(private readonly storage: DurableObjectStorage) {}

  deleteAll(): Promise<void> {
    return this.storage.deleteAll();
  }

  getAlarm(): Promise<number | null> {
    return this.storage.getAlarm();
  }

  setAlarm(at: number): Promise<void> {
    return this.storage.setAlarm(at);
  }

  deleteAlarm(): Promise<void> {
    return this.storage.deleteAlarm();
  }
}

/** Wraps a hibernatable WebSocket (meta = its serialized attachment). */
export function wrapSocket(ws: WebSocket): RoomSocket {
  const meta = (ws.deserializeAttachment() as SocketMeta | null) ?? {
    sub: '',
    actingAs: false,
    n: 0,
  };
  return {
    meta,
    send: text => ws.send(text),
    close: (code, reason) => ws.close(code, reason),
  };
}

/** SocketHub over the Durable Object state (tag = sub). */
export class DoSocketHub implements SocketHub {
  constructor(private readonly state: DurableObjectState) {}

  list(sub?: string): RoomSocket[] {
    return this.state.getWebSockets(sub).map(wrapSocket);
  }
}
