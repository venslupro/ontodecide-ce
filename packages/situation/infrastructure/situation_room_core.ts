/**
 * @fileoverview SituationRoom logic (one Durable Object per tenant): holds
 * live KPIs and open alerts, numbers every pushed message and keeps the
 * last 200 for replay after reconnects. The DO wrapper only delegates.
 */

import {type Clock, systemClock} from '@ontodecide/shared-kernel';
import type {SituationRoomApi, WsMsgType} from '../application';
import type {AlertDto, Severity, WsMsg} from '../contract';
import {SEVERITY_RANK} from '../domain';
import type {SqlStorageLike} from './sql_storage';

/** Sends a serialized frame to every connected socket. */
export interface Broadcaster {
  broadcast(frame: string): void;
}

/** Messages retained for replay. */
export const WS_REPLAY_WINDOW = 200;

/** Snapshot payload. */
export interface RoomSnapshot {
  kpis: unknown[];
  alerts: AlertDto[];
}

/** Frame returned to the client for `ping`. */
export const PONG_FRAME = {type: 'pong'} as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kpi (
  id TEXT PRIMARY KEY, value REAL, updated_at INTEGER, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS open_alert (
  id TEXT PRIMARY KEY, rid TEXT, severity TEXT, raised_at INTEGER,
  data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox_ws (
  seq INTEGER PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL,
  occurred_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`;

/** SituationRoom state machine over DO SQLite. */
export class SituationRoomCore implements SituationRoomApi {
  constructor(
    private readonly sql: SqlStorageLike,
    private readonly broadcaster: Broadcaster = {broadcast: () => {}},
    private readonly clock: Clock = systemClock,
  ) {
    this.sql.exec(SCHEMA);
  }

  /** Last assigned sequence number (0 when nothing was published). */
  currentSeq(): number {
    const rows = this.sql
      .exec<{value: number}>("SELECT value FROM meta WHERE key = 'seq'")
      .toArray();
    return rows.length > 0 ? Number(rows[0].value) : 0;
  }

  async publish(
    type: Exclude<WsMsgType, 'snapshot'>,
    data: unknown,
  ): Promise<WsMsg> {
    this.apply(type, data);
    const seq = this.currentSeq() + 1;
    const occurredAt = this.clock.now().toISOString();
    this.sql.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('seq', ?)",
      seq,
    );
    this.sql.exec(
      'INSERT INTO outbox_ws (seq, type, data, occurred_at) VALUES (?, ?, ?, ?)',
      seq,
      type,
      JSON.stringify(data ?? null),
      occurredAt,
    );
    this.sql.exec(
      'DELETE FROM outbox_ws WHERE seq <= ?',
      seq - WS_REPLAY_WINDOW,
    );
    const msg: WsMsg = {seq, type, data, occurredAt};
    this.broadcaster.broadcast(JSON.stringify(msg));
    return msg;
  }

  private apply(type: WsMsgType, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    if (type === 'kpi') {
      const k = data as {
        id?: unknown;
        deleted?: boolean;
        value?: unknown;
        updatedAt?: unknown;
      };
      if (typeof k.id !== 'string') return;
      if (k.deleted) {
        this.sql.exec('DELETE FROM kpi WHERE id = ?', k.id);
        return;
      }
      this.sql.exec(
        'INSERT OR REPLACE INTO kpi (id, value, updated_at, data) VALUES (?, ?, ?, ?)',
        k.id,
        typeof k.value === 'number' ? k.value : null,
        typeof k.updatedAt === 'string' ? Date.parse(k.updatedAt) : null,
        JSON.stringify(data),
      );
    } else if (type === 'alert') {
      const a = data as Partial<AlertDto>;
      if (typeof a.id !== 'string') return;
      if (a.status === 'CLOSED') {
        this.sql.exec('DELETE FROM open_alert WHERE id = ?', a.id);
        return;
      }
      this.sql.exec(
        `INSERT OR REPLACE INTO open_alert (id, rid, severity, raised_at, data)
         VALUES (?, ?, ?, ?, ?)`,
        a.id,
        a.rid ?? null,
        a.severity ?? null,
        a.raisedAt ? Date.parse(a.raisedAt) : null,
        JSON.stringify(data),
      );
    }
  }

  async snapshot(): Promise<WsMsg> {
    const kpis = this.sql
      .exec<{data: string}>('SELECT data FROM kpi ORDER BY id')
      .toArray()
      .map(r => JSON.parse(r.data) as unknown);
    const alerts = this.sql
      .exec<{data: string}>('SELECT data FROM open_alert')
      .toArray()
      .map(r => JSON.parse(r.data) as AlertDto)
      .sort(
        (a, b) =>
          (SEVERITY_RANK[b.severity as Severity] ?? 0) -
            (SEVERITY_RANK[a.severity as Severity] ?? 0) ||
          (b.raisedAt ?? '').localeCompare(a.raisedAt ?? ''),
      );
    const data: RoomSnapshot = {kpis, alerts};
    return {
      seq: this.currentSeq(),
      type: 'snapshot',
      data,
      occurredAt: this.clock.now().toISOString(),
    };
  }

  async since(lastSeq: number): Promise<WsMsg[] | null> {
    if (!Number.isInteger(lastSeq) || lastSeq < 0) return null;
    const cur = this.currentSeq();
    if (lastSeq > cur) return null;
    if (lastSeq === cur) return [];
    const min = this.sql
      .exec<{m: number | null}>('SELECT MIN(seq) AS m FROM outbox_ws')
      .toArray()[0]?.m;
    if (min === null || min === undefined || lastSeq + 1 < Number(min)) {
      return null;
    }
    return this.sql
      .exec<{seq: number; type: string; data: string; occurred_at: string}>(
        'SELECT seq, type, data, occurred_at FROM outbox_ws WHERE seq > ? ORDER BY seq',
        lastSeq,
      )
      .toArray()
      .map(r => ({
        seq: Number(r.seq),
        type: r.type as WsMsg['type'],
        data: JSON.parse(r.data) as unknown,
        occurredAt: r.occurred_at,
      }));
  }

  /**
   * Frames for a newly connected socket: the missed messages when
   * `lastSeq` is within the window, otherwise a snapshot.
   */
  async connect(lastSeq?: number | null): Promise<WsMsg[]> {
    if (typeof lastSeq === 'number') {
      const missed = await this.since(lastSeq);
      if (missed) return missed;
    }
    return [await this.snapshot()];
  }

  /**
   * Handles a client frame and returns the frames to send back to that
   * socket: `ping` → pong, `resume` → replay or snapshot.
   */
  async handleFrame(raw: string | ArrayBuffer): Promise<unknown[]> {
    if (typeof raw !== 'string') return [];
    let frame: {type?: unknown; lastSeq?: unknown};
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return [];
    }
    if (frame?.type === 'ping') return [PONG_FRAME];
    if (frame?.type === 'resume') {
      const n = Number(frame.lastSeq);
      return this.connect(Number.isFinite(n) ? n : null);
    }
    return [];
  }
}

/** Parses the `lastSeq` query parameter of a stream request. */
export function parseLastSeq(url: string): number | null {
  const v = new URL(url).searchParams.get('lastSeq');
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
