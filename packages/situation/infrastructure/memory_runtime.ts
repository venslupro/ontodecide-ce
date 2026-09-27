/**
 * @fileoverview In-memory Durable Object runtime pieces for Node: storage
 * (deleteAll drops every table of the SQL storage; alarm kept in memory)
 * and a socket hub with recording sockets. Used by tests and the
 * in-process harness.
 */

import type {RoomSocket, RoomStorage, SocketHub} from '../application/ports';
import type {SocketMeta} from '../domain';
import type {SqlStorageLike} from './sql_storage';

/** RoomStorage over a SqlStorageLike with an in-memory alarm. */
export class InMemoryRoomStorage implements RoomStorage {
  alarm: number | null = null;
  deleteAllCalls = 0;

  constructor(private readonly sql: SqlStorageLike) {}

  async deleteAll(): Promise<void> {
    this.deleteAllCalls++;
    const tables = this.sql
      .exec<{name: string}>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'",
      )
      .toArray();
    for (const t of tables) this.sql.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    this.alarm = null;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(at: number): Promise<void> {
    this.alarm = at;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

/** A socket that records what it was sent. */
export class MemorySocket implements RoomSocket {
  readonly sent: string[] = [];
  closed: {code: number; reason: string} | null = null;

  constructor(
    readonly meta: SocketMeta,
    private readonly hub: MemorySocketHub,
  ) {}

  send(text: string): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(text);
  }

  close(code: number, reason: string): void {
    this.closed = {code, reason};
    this.hub.remove(this);
  }

  /** Parsed messages. */
  messages<T = {seq: number; type: string; data: unknown}>(): T[] {
    return this.sent.map(s => JSON.parse(s) as T);
  }
}

/** Socket hub keeping accepted sockets in memory (tag = sub). */
export class MemorySocketHub implements SocketHub {
  private readonly sockets: MemorySocket[] = [];

  /** Accepts a socket (as ctx.acceptWebSocket(ws, [sub]) would). */
  accept(meta: SocketMeta): MemorySocket {
    const s = new MemorySocket(meta, this);
    this.sockets.push(s);
    return s;
  }

  remove(s: MemorySocket): void {
    const i = this.sockets.indexOf(s);
    if (i >= 0) this.sockets.splice(i, 1);
  }

  list(sub?: string): MemorySocket[] {
    return this.sockets.filter(s => sub === undefined || s.meta.sub === sub);
  }
}
