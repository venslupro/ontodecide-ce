/**
 * @fileoverview SituationRoom SQLite store (详细设计 6.11.4). One Durable
 * Object instance is one workspace, so tables carry no tenant_id. Every
 * statement is a single `exec` call (synchronous in the runtime).
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {
  AlertCursor,
  AlertRecord,
  AutomationRecord,
  KpiRecord,
  OutboxRecord,
  PointRecord,
  RoomStore,
  TicketRecord,
} from '../application/ports';
import type {AlertFilter, WsMsg} from '../contract/types';
import type {KpiDefinition, KpiState, ObjectView} from '../domain';
import type {SqlStorageLike} from './sql_storage';

/** Current schema version (V1.3 rooms had none). */
export const ROOM_SCHEMA_VERSION = '2.4.0';

const META = 'room_meta';
const TOMBSTONE_KEY = 'tombstone_until';

const SCHEMA = [
  `CREATE TABLE ${META} (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE kpi_def (id TEXT PRIMARY KEY, name TEXT NOT NULL,
     object_type TEXT NOT NULL, aggregate TEXT NOT NULL, filter TEXT,
     unit TEXT, target REAL, higher_is_better INTEGER NOT NULL DEFAULT 1,
     ord INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE kpi_value (id TEXT PRIMARY KEY, value REAL,
     cnt INTEGER NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
     updated_at INTEGER)`,
  `CREATE TABLE metric_point (metric TEXT NOT NULL, ts INTEGER NOT NULL,
     value REAL NOT NULL, PRIMARY KEY (metric, ts)) WITHOUT ROWID`,
  `CREATE TABLE automation (id TEXT PRIMARY KEY, name TEXT NOT NULL,
     trigger TEXT NOT NULL CHECK (trigger IN ('threshold','schedule')),
     object_type TEXT NOT NULL, condition TEXT NOT NULL, every_hours INTEGER,
     next_run_at INTEGER, severity TEXT NOT NULL,
     cooldown_sec INTEGER NOT NULL, enabled INTEGER NOT NULL,
     version INTEGER NOT NULL, last_fired_at INTEGER,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE alert (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL,
     automation_name TEXT NOT NULL, rid TEXT, title TEXT NOT NULL,
     severity TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('OPEN','ACKED','CLOSED')),
     snapshot TEXT NOT NULL, hits INTEGER NOT NULL,
     raised_at INTEGER NOT NULL, acked_at INTEGER, closed_at INTEGER)`,
  `CREATE UNIQUE INDEX ux_alert_open ON alert (automation_id, rid)
     WHERE status = 'OPEN'`,
  'CREATE INDEX ix_alert_pair ON alert (automation_id, rid, closed_at)',
  'CREATE INDEX ix_alert_raised ON alert (raised_at, id)',
  'CREATE TABLE seen_event (event_id TEXT PRIMARY KEY, at INTEGER NOT NULL)',
  `CREATE TABLE stream_ticket (ticket_hash TEXT PRIMARY KEY,
     sub TEXT NOT NULL, act_as INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE outbox_ws (seq INTEGER PRIMARY KEY, type TEXT NOT NULL,
     data TEXT NOT NULL, occurred_at INTEGER NOT NULL)`,
  `CREATE TABLE object_cache (rid TEXT PRIMARY KEY, type TEXT NOT NULL,
     title TEXT NOT NULL, props TEXT NOT NULL)`,
];

/** Tables counted by countTenant (everything but the meta table). */
const DATA_TABLES = [
  'kpi_def',
  'kpi_value',
  'metric_point',
  'automation',
  'alert',
  'seen_event',
  'stream_ticket',
  'outbox_ws',
  'object_cache',
];

type Row = Record<string, unknown>;

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function toAutomation(r: Row): AutomationRecord {
  const everyHours = num(r.every_hours);
  return {
    id: String(r.id),
    name: parseJson(String(r.name), ''),
    trigger: r.trigger as AutomationRecord['trigger'],
    objectType: String(r.object_type),
    condition: parseJson(String(r.condition), {op: 'and', args: []}),
    ...(everyHours !== null ? {everyHours} : {}),
    severity: r.severity as AutomationRecord['severity'],
    cooldownSec: Number(r.cooldown_sec),
    enabled: Number(r.enabled) === 1,
    version: Number(r.version),
    nextRunAt: num(r.next_run_at),
    lastFiredAt: num(r.last_fired_at),
    createdAt: Number(r.created_at),
  };
}

function toAlert(r: Row): AlertRecord {
  return {
    id: String(r.id),
    automationId: String(r.automation_id),
    automationName: parseJson(String(r.automation_name), ''),
    rid: r.rid === null || r.rid === undefined ? null : String(r.rid),
    title: String(r.title),
    severity: r.severity as AlertRecord['severity'],
    status: r.status as AlertRecord['status'],
    snapshot: parseJson(String(r.snapshot), {}),
    hits: Number(r.hits),
    raisedAt: Number(r.raised_at),
    ackedAt: num(r.acked_at),
    closedAt: num(r.closed_at),
  };
}

function toObject(r: Row): ObjectView {
  return {
    rid: String(r.rid),
    type: String(r.type),
    title: String(r.title),
    props: parseJson(String(r.props), {}),
  };
}

const SEVERITY_ORDER = `CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3
  WHEN 'MEDIUM' THEN 2 ELSE 1 END`;

/** {@link RoomStore} over Durable Object SQL storage. */
export class SqlRoomStore implements RoomStore {
  constructor(private readonly sql: SqlStorageLike) {}

  private rows(q: string, ...b: unknown[]): Row[] {
    return this.sql.exec<Row>(q, ...b).toArray();
  }

  private first(q: string, ...b: unknown[]): Row | null {
    return this.rows(q, ...b)[0] ?? null;
  }

  private run(q: string, ...b: unknown[]): number {
    return this.sql.exec(q, ...b).rowsWritten;
  }

  private hasMetaTable(): boolean {
    return (
      this.first(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        META,
      ) !== null
    );
  }

  migrate(): void {
    if (this.hasMetaTable()) {
      if (this.getMeta(TOMBSTONE_KEY) !== null) return;
      if (this.getMeta('schema_version') === ROOM_SCHEMA_VERSION) return;
    }
    // First start (or V1.3 room): drop every user table, then create ours.
    const tables = this.rows(
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'
         AND name NOT GLOB '__cf_*'`,
    ).map(r => String(r.name));
    for (const t of tables) this.run(`DROP TABLE IF EXISTS "${t}"`);
    for (const ddl of SCHEMA) this.run(ddl);
    this.setMeta('schema_version', ROOM_SCHEMA_VERSION);
  }

  tombstoneUntil(): number | null {
    if (!this.hasMetaTable()) return null;
    const v = this.getMeta(TOMBSTONE_KEY);
    return v === null ? null : Number(v);
  }

  writeTombstone(until: number): void {
    if (!this.hasMetaTable()) this.run(SCHEMA[0]);
    this.setMeta(TOMBSTONE_KEY, String(until));
  }

  getMeta(key: string): string | null {
    const r = this.first(`SELECT v FROM ${META} WHERE k = ?`, key);
    return r ? String(r.v) : null;
  }

  setMeta(key: string, value: string): void {
    this.run(
      `INSERT INTO ${META} (k, v) VALUES (?, ?)
         ON CONFLICT (k) DO UPDATE SET v = excluded.v`,
      key,
      value,
    );
  }

  deleteMeta(key: string): void {
    this.run(`DELETE FROM ${META} WHERE k = ?`, key);
  }

  countRows(): number {
    if (this.tombstoneUntil() !== null) return 0;
    let n = 0;
    for (const t of DATA_TABLES) {
      const r = this.first(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        t,
      );
      if (r) n += Number(this.first(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0);
    }
    return n;
  }

  // --- KPIs -------------------------------------------------------------

  listKpis(): KpiRecord[] {
    return this.rows(
      `SELECT d.*, v.value, v.cnt, v.total, v.updated_at
         FROM kpi_def d LEFT JOIN kpi_value v ON v.id = d.id
        ORDER BY d.ord, d.id`,
    ).map(r => ({
      id: String(r.id),
      name: parseJson(String(r.name), ''),
      objectType: String(r.object_type),
      aggregate: parseJson(String(r.aggregate), {fn: 'count' as const}),
      ...(r.filter ? {filter: parseJson(String(r.filter), undefined)} : {}),
      unit: r.unit === null ? null : String(r.unit),
      target: num(r.target),
      higherIsBetter: Number(r.higher_is_better) === 1,
      state: {
        cnt: Number(r.cnt ?? 0),
        total: Number(r.total ?? 0),
        value: num(r.value),
      },
      updatedAt: num(r.updated_at),
    }));
  }

  insertKpi(
    def: KpiDefinition,
    state: KpiState,
    now: number,
    ord: number,
  ): void {
    this.run(
      `INSERT OR REPLACE INTO kpi_def (id, name, object_type, aggregate, filter,
         unit, target, higher_is_better, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      def.id,
      JSON.stringify(def.name),
      def.objectType,
      JSON.stringify(def.aggregate),
      def.filter ? JSON.stringify(def.filter) : null,
      def.unit,
      def.target,
      def.higherIsBetter ? 1 : 0,
      ord,
    );
    this.saveKpiState(def.id, state, now);
  }

  saveKpiState(id: string, state: KpiState, now: number): void {
    this.run(
      `INSERT INTO kpi_value (id, value, cnt, total, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET value = excluded.value,
           cnt = excluded.cnt, total = excluded.total,
           updated_at = excluded.updated_at`,
      id,
      state.value,
      state.cnt,
      state.total,
      now,
    );
  }

  deleteKpi(id: string): void {
    this.run('DELETE FROM kpi_value WHERE id = ?', id);
    this.run('DELETE FROM kpi_def WHERE id = ?', id);
  }

  // --- Metric points ------------------------------------------------------

  lastPoint(metric: string): PointRecord | null {
    return this.pointAtOrBefore(metric, Number.MAX_SAFE_INTEGER);
  }

  pointAtOrBefore(metric: string, ts: number): PointRecord | null {
    const r = this.first(
      `SELECT metric, ts, value FROM metric_point
        WHERE metric = ? AND ts <= ? ORDER BY ts DESC LIMIT 1`,
      metric,
      ts,
    );
    return r
      ? {metric: String(r.metric), ts: Number(r.ts), value: Number(r.value)}
      : null;
  }

  putPoint(p: PointRecord): void {
    this.run(
      `INSERT INTO metric_point (metric, ts, value) VALUES (?, ?, ?)
         ON CONFLICT (metric, ts) DO UPDATE SET value = excluded.value`,
      p.metric,
      p.ts,
      p.value,
    );
  }

  listPoints(sinceTs: number): PointRecord[] {
    return this.rows(
      `SELECT metric, ts, value FROM metric_point WHERE ts >= ?
        ORDER BY metric, ts`,
      sinceTs,
    ).map(r => ({
      metric: String(r.metric),
      ts: Number(r.ts),
      value: Number(r.value),
    }));
  }

  prunePoints(beforeTs: number): void {
    this.run(
      `DELETE FROM metric_point WHERE ts < ? AND ts < (
         SELECT MAX(m.ts) FROM metric_point m
          WHERE m.metric = metric_point.metric)`,
      beforeTs,
    );
  }

  // --- Object cache -----------------------------------------------------

  getObject(rid: string): ObjectView | null {
    const r = this.first('SELECT * FROM object_cache WHERE rid = ?', rid);
    return r ? toObject(r) : null;
  }

  listObjects(type?: string): ObjectView[] {
    return (
      type
        ? this.rows(
            'SELECT * FROM object_cache WHERE type = ? ORDER BY rid',
            type,
          )
        : this.rows('SELECT * FROM object_cache ORDER BY rid')
    ).map(toObject);
  }

  putObject(o: ObjectView): void {
    this.run(
      `INSERT INTO object_cache (rid, type, title, props) VALUES (?, ?, ?, ?)
         ON CONFLICT (rid) DO UPDATE SET type = excluded.type,
           title = excluded.title, props = excluded.props`,
      o.rid,
      o.type,
      o.title,
      JSON.stringify(o.props),
    );
  }

  deleteObject(rid: string): void {
    this.run('DELETE FROM object_cache WHERE rid = ?', rid);
  }

  // --- Automations --------------------------------------------------------

  listAutomations(): AutomationRecord[] {
    return this.rows('SELECT * FROM automation ORDER BY created_at, id').map(
      toAutomation,
    );
  }

  getAutomation(id: string): AutomationRecord | null {
    const r = this.first('SELECT * FROM automation WHERE id = ?', id);
    return r ? toAutomation(r) : null;
  }

  insertAutomation(a: AutomationRecord): void {
    this.run(
      `INSERT INTO automation (id, name, trigger, object_type, condition,
         every_hours, next_run_at, severity, cooldown_sec, enabled, version,
         last_fired_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id,
      JSON.stringify(a.name),
      a.trigger,
      a.objectType,
      JSON.stringify(a.condition),
      a.everyHours ?? null,
      a.nextRunAt,
      a.severity,
      a.cooldownSec,
      a.enabled ? 1 : 0,
      a.version,
      a.lastFiredAt,
      a.createdAt,
    );
  }

  updateAutomation(a: AutomationRecord): void {
    this.run(
      `UPDATE automation SET name = ?, trigger = ?, object_type = ?,
         condition = ?, every_hours = ?, next_run_at = ?, severity = ?,
         cooldown_sec = ?, enabled = ?, version = ?, last_fired_at = ?
       WHERE id = ?`,
      JSON.stringify(a.name),
      a.trigger,
      a.objectType,
      JSON.stringify(a.condition),
      a.everyHours ?? null,
      a.nextRunAt,
      a.severity,
      a.cooldownSec,
      a.enabled ? 1 : 0,
      a.version,
      a.lastFiredAt,
      a.id,
    );
  }

  deleteAutomation(id: string): void {
    this.run('DELETE FROM automation WHERE id = ?', id);
  }

  setLastFired(id: string, at: number): void {
    this.run('UPDATE automation SET last_fired_at = ? WHERE id = ?', at, id);
  }

  countScheduled(excludeId?: string): number {
    const r = this.first(
      `SELECT COUNT(*) AS n FROM automation
        WHERE trigger = 'schedule' AND id <> ?`,
      excludeId ?? '',
    );
    return Number(r?.n ?? 0);
  }

  // --- Alerts -------------------------------------------------------------

  activeAlert(automationId: string, rid: string): AlertRecord | null {
    const r = this.first(
      `SELECT * FROM alert WHERE automation_id = ? AND rid = ?
          AND status IN ('OPEN','ACKED') ORDER BY raised_at DESC LIMIT 1`,
      automationId,
      rid,
    );
    return r ? toAlert(r) : null;
  }

  lastClosedAlert(automationId: string, rid: string): AlertRecord | null {
    const r = this.first(
      `SELECT * FROM alert WHERE automation_id = ? AND rid = ?
          AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1`,
      automationId,
      rid,
    );
    return r ? toAlert(r) : null;
  }

  activeAlertsOf(automationId: string): AlertRecord[] {
    return this.rows(
      `SELECT * FROM alert WHERE automation_id = ?
          AND status IN ('OPEN','ACKED')`,
      automationId,
    ).map(toAlert);
  }

  activeAlertsFor(rid: string): AlertRecord[] {
    return this.rows(
      "SELECT * FROM alert WHERE rid = ? AND status IN ('OPEN','ACKED')",
      rid,
    ).map(toAlert);
  }

  getAlert(id: string): AlertRecord | null {
    const r = this.first('SELECT * FROM alert WHERE id = ?', id);
    return r ? toAlert(r) : null;
  }

  insertAlert(a: AlertRecord): void {
    this.run(
      `INSERT INTO alert (id, automation_id, automation_name, rid, title,
         severity, status, snapshot, hits, raised_at, acked_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id,
      a.automationId,
      JSON.stringify(a.automationName),
      a.rid,
      a.title,
      a.severity,
      a.status,
      JSON.stringify(a.snapshot),
      a.hits,
      a.raisedAt,
      a.ackedAt,
      a.closedAt,
    );
  }

  updateAlert(a: AlertRecord): void {
    this.run(
      `UPDATE alert SET automation_name = ?, title = ?, severity = ?,
         status = ?, snapshot = ?, hits = ?, acked_at = ?, closed_at = ?
       WHERE id = ?`,
      JSON.stringify(a.automationName),
      a.title,
      a.severity,
      a.status,
      JSON.stringify(a.snapshot),
      a.hits,
      a.ackedAt,
      a.closedAt,
      a.id,
    );
  }

  listAlerts(
    filter: AlertFilter,
    after: AlertCursor | null,
    limit: number,
  ): AlertRecord[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.status) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.severity) {
      where.push('severity = ?');
      args.push(filter.severity);
    }
    if (filter.rid) {
      where.push('rid = ?');
      args.push(filter.rid);
    }
    if (after) {
      where.push('(raised_at < ? OR (raised_at = ? AND id < ?))');
      args.push(after.t, after.t, after.i);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.rows(
      `SELECT * FROM alert ${clause} ORDER BY raised_at DESC, id DESC LIMIT ?`,
      ...args,
      limit,
    ).map(toAlert);
  }

  activeAlerts(limit: number): AlertRecord[] {
    return this.rows(
      `SELECT * FROM alert WHERE status IN ('OPEN','ACKED')
        ORDER BY ${SEVERITY_ORDER} DESC,
          CASE status WHEN 'OPEN' THEN 0 ELSE 1 END,
          raised_at DESC, id DESC
        LIMIT ?`,
      limit,
    ).map(toAlert);
  }

  allAlerts(): AlertRecord[] {
    return this.rows('SELECT * FROM alert ORDER BY raised_at, id').map(toAlert);
  }

  // --- Event dedupe -------------------------------------------------------

  isSeen(eventId: string): boolean {
    return (
      this.first(
        'SELECT 1 AS x FROM seen_event WHERE event_id = ?',
        eventId,
      ) !== null
    );
  }

  markSeen(eventId: string, at: number): void {
    this.run(
      'INSERT OR IGNORE INTO seen_event (event_id, at) VALUES (?, ?)',
      eventId,
      at,
    );
  }

  pruneSeen(beforeTs: number): void {
    this.run('DELETE FROM seen_event WHERE at < ?', beforeTs);
  }

  // --- Stream tickets -----------------------------------------------------

  insertTicket(hash: string, t: TicketRecord): void {
    this.run(
      `INSERT INTO stream_ticket (ticket_hash, sub, act_as, expires_at)
         VALUES (?, ?, ?, ?)`,
      hash,
      t.sub,
      t.actingAs ? 1 : 0,
      t.expiresAt,
    );
  }

  takeTicket(hash: string): TicketRecord | null {
    const r = this.first(
      'DELETE FROM stream_ticket WHERE ticket_hash = ? RETURNING sub, act_as, expires_at',
      hash,
    );
    return r
      ? {
          sub: String(r.sub),
          actingAs: Number(r.act_as) === 1,
          expiresAt: Number(r.expires_at),
        }
      : null;
  }

  pruneTickets(now: number): void {
    this.run('DELETE FROM stream_ticket WHERE expires_at <= ?', now);
  }

  // --- Realtime outbox ----------------------------------------------------

  appendWs(type: WsMsg['type'], data: unknown, at: number): number {
    const r = this.first(
      `INSERT INTO outbox_ws (seq, type, data, occurred_at)
         VALUES ((SELECT COALESCE(MAX(seq), 0) + 1 FROM outbox_ws), ?, ?, ?)
         RETURNING seq`,
      type,
      JSON.stringify(data),
      at,
    );
    return Number(r?.seq ?? 0);
  }

  wsBounds(): {minSeq: number; maxSeq: number} {
    const r = this.first(
      'SELECT COALESCE(MIN(seq), 0) AS lo, COALESCE(MAX(seq), 0) AS hi FROM outbox_ws',
    );
    return {minSeq: Number(r?.lo ?? 0), maxSeq: Number(r?.hi ?? 0)};
  }

  wsSince(afterSeq: number): OutboxRecord[] {
    return this.rows(
      'SELECT * FROM outbox_ws WHERE seq > ? ORDER BY seq',
      afterSeq,
    ).map(r => ({
      seq: Number(r.seq),
      type: r.type as WsMsg['type'],
      data: parseJson(String(r.data), null),
      occurredAt: Number(r.occurred_at),
    }));
  }

  pruneWs(keep: number): void {
    this.run(
      `DELETE FROM outbox_ws WHERE seq <= (
         SELECT COALESCE(MAX(seq), 0) - ? FROM outbox_ws)`,
      keep,
    );
  }
}
