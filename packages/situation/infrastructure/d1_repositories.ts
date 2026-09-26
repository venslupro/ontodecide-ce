/**
 * @fileoverview D1 repositories of the situation database. Every query on
 * tenant data filters by tenant id; the only cross-tenant statements are
 * TTL maintenance and the system tables (processed events, usage days).
 */

import type {
  I18nText,
  ObjectSetDef,
  Rid,
  UsageResource,
} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AlertFilter,
  AlertStatus,
  AutomationDto,
  CockpitLayout,
  DeadLetterDto,
  KpiAggregate,
  RecommendationSummary,
  Severity,
} from '../contract';
import type {
  AlertRepository,
  AutomationRepository,
  DeadLetterRepository,
  KpiRecord,
  KpiRepository,
  LayoutRepository,
  MetricRepository,
  NewAlert,
  NewDeadLetter,
  ProcessedEventRepository,
  RecommendationRepository,
  SituationRepositories,
  UsageDayRepository,
} from '../application';
import type {LatestAlert, RawPoint} from '../domain';

type Row = Record<string, unknown>;

/** Bound-parameter chunk size (D1 allows 100 per statement). */
const CHUNK = 50;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function iso(value: unknown): string | undefined {
  const n = num(value);
  return n === null ? undefined : new Date(n).toISOString();
}

async function all(stmt: D1PreparedStatement): Promise<Row[]> {
  const r = await stmt.all<Row>();
  return r.results ?? [];
}

function changes(r: D1Result): number {
  return Number(r.meta?.changes ?? 0);
}

/** sit_kpi. */
export class D1KpiRepository implements KpiRepository {
  constructor(private readonly db: D1Database) {}

  private map(r: Row): KpiRecord {
    return {
      id: String(r.id),
      name: json<I18nText>(r.name, String(r.name)),
      objectSet: json<ObjectSetDef>(r.object_set, {objectType: ''}),
      aggregate: json<KpiAggregate>(r.aggregate, {fn: 'count'}),
      ...(r.unit !== null ? {unit: String(r.unit)} : {}),
      ...(r.target !== null ? {target: Number(r.target)} : {}),
      higherIsBetter: Number(r.higher_is_better) === 1,
      value: num(r.value),
      updatedAt: num(r.updated_at),
      createdAt: Number(r.created_at),
    };
  }

  async list(tenantId: string): Promise<KpiRecord[]> {
    const rows = await all(
      this.db
        .prepare(
          'SELECT * FROM sit_kpi WHERE tenant_id = ? ORDER BY created_at, id',
        )
        .bind(tenantId),
    );
    return rows.map(r => this.map(r));
  }

  async get(tenantId: string, id: string): Promise<KpiRecord | null> {
    const r = await this.db
      .prepare('SELECT * FROM sit_kpi WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, id)
      .first<Row>();
    return r ? this.map(r) : null;
  }

  async save(tenantId: string, k: KpiRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sit_kpi (id, tenant_id, name, object_set, aggregate, unit,
           target, higher_is_better, value, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name,
           object_set = excluded.object_set, aggregate = excluded.aggregate,
           unit = excluded.unit, target = excluded.target,
           higher_is_better = excluded.higher_is_better
         WHERE sit_kpi.tenant_id = excluded.tenant_id`,
      )
      .bind(
        k.id,
        tenantId,
        JSON.stringify(k.name),
        JSON.stringify(k.objectSet),
        JSON.stringify(k.aggregate),
        k.unit ?? null,
        k.target ?? null,
        k.higherIsBetter === false ? 0 : 1,
        k.value,
        k.updatedAt,
        k.createdAt,
      )
      .run();
  }

  async setValue(
    tenantId: string,
    id: string,
    value: number | null,
    at: number,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE sit_kpi SET value = ?, updated_at = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(value, at, tenantId, id)
      .run();
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const r = await this.db
      .prepare('DELETE FROM sit_kpi WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, id)
      .run();
    return changes(r) > 0;
  }

  async tenants(): Promise<string[]> {
    const rows = await all(
      this.db.prepare('SELECT DISTINCT tenant_id FROM sit_kpi'),
    );
    return rows.map(r => String(r.tenant_id));
  }
}

/** sit_metric_point. */
export class D1MetricRepository implements MetricRepository {
  constructor(private readonly db: D1Database) {}

  async upsert(
    tenantId: string,
    metric: string,
    ts: number,
    value: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sit_metric_point (tenant_id, metric, ts, value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, metric, ts) DO UPDATE SET value = excluded.value`,
      )
      .bind(tenantId, metric, ts, value)
      .run();
  }

  async range(
    tenantId: string,
    metrics: string[],
    fromMs: number,
    toMs: number,
  ): Promise<Map<string, RawPoint[]>> {
    const out = new Map<string, RawPoint[]>();
    for (const part of chunks(metrics)) {
      const rows = await all(
        this.db
          .prepare(
            `SELECT metric, ts, value FROM sit_metric_point
             WHERE tenant_id = ? AND metric IN (${part.map(() => '?').join(',')})
               AND ts > ? AND ts <= ? ORDER BY ts`,
          )
          .bind(tenantId, ...part, fromMs, toMs),
      );
      for (const r of rows) {
        const m = String(r.metric);
        const list = out.get(m) ?? [];
        list.push({ts: Number(r.ts), value: Number(r.value)});
        out.set(m, list);
      }
    }
    return out;
  }

  async deleteMetric(tenantId: string, metric: string): Promise<void> {
    await this.db
      .prepare(
        'DELETE FROM sit_metric_point WHERE tenant_id = ? AND metric = ?',
      )
      .bind(tenantId, metric)
      .run();
  }

  async deleteOlderThan(ts: number): Promise<number> {
    const r = await this.db
      .prepare('DELETE FROM sit_metric_point WHERE ts < ?')
      .bind(ts)
      .run();
    return changes(r);
  }
}

/** sit_automation. */
export class D1AutomationRepository implements AutomationRepository {
  constructor(private readonly db: D1Database) {}

  private map(r: Row): AutomationDto {
    const condition = json<AutomationDto['condition'] | null>(
      r.condition,
      null,
    );
    const lastFiredAt = iso(r.last_fired_at);
    return {
      id: String(r.id),
      name: json<I18nText>(r.name, String(r.name)),
      trigger: json<AutomationDto['trigger']>(r.trigger, {
        kind: 'threshold',
        objectType: '',
      }),
      ...(condition ? {condition} : {}),
      effects: json<AutomationDto['effects']>(r.effect, []),
      severity: String(r.severity) as Severity,
      cooldownSec: Number(r.cooldown_sec),
      enabled: Number(r.enabled) === 1,
      createdAt: new Date(Number(r.created_at)).toISOString(),
      ...(lastFiredAt ? {lastFiredAt} : {}),
    };
  }

  async list(tenantId: string): Promise<AutomationDto[]> {
    const rows = await all(
      this.db
        .prepare(
          'SELECT * FROM sit_automation WHERE tenant_id = ? ORDER BY created_at, id',
        )
        .bind(tenantId),
    );
    return rows.map(r => this.map(r));
  }

  async get(tenantId: string, id: string): Promise<AutomationDto | null> {
    const r = await this.db
      .prepare('SELECT * FROM sit_automation WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, id)
      .first<Row>();
    return r ? this.map(r) : null;
  }

  async save(tenantId: string, a: AutomationDto): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sit_automation (id, tenant_id, name, trigger, condition,
           effect, severity, cooldown_sec, enabled, last_fired_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name,
           trigger = excluded.trigger, condition = excluded.condition,
           effect = excluded.effect, severity = excluded.severity,
           cooldown_sec = excluded.cooldown_sec, enabled = excluded.enabled
         WHERE sit_automation.tenant_id = excluded.tenant_id`,
      )
      .bind(
        a.id,
        tenantId,
        JSON.stringify(a.name),
        JSON.stringify(a.trigger),
        a.condition ? JSON.stringify(a.condition) : null,
        JSON.stringify(a.effects),
        a.severity,
        a.cooldownSec,
        a.enabled ? 1 : 0,
        a.lastFiredAt ? new Date(a.lastFiredAt).getTime() : null,
        new Date(a.createdAt).getTime(),
      )
      .run();
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const r = await this.db
      .prepare('DELETE FROM sit_automation WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, id)
      .run();
    return changes(r) > 0;
  }

  async markFired(tenantId: string, id: string, at: number): Promise<void> {
    await this.db
      .prepare(
        'UPDATE sit_automation SET last_fired_at = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(at, tenantId, id)
      .run();
  }

  async tenants(): Promise<string[]> {
    const rows = await all(
      this.db.prepare(
        'SELECT DISTINCT tenant_id FROM sit_automation WHERE enabled = 1',
      ),
    );
    return rows.map(r => String(r.tenant_id));
  }
}

const ALERT_SELECT = `SELECT a.*, au.name AS automation_name FROM sit_alert a
  LEFT JOIN sit_automation au
    ON au.id = a.automation_id AND au.tenant_id = a.tenant_id`;

const SEVERITY_ORDER = `CASE a.severity WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2
  WHEN 'MEDIUM' THEN 1 ELSE 0 END`;

/** sit_alert. */
export class D1AlertRepository implements AlertRepository {
  constructor(private readonly db: D1Database) {}

  private map(r: Row): AlertDto {
    const closedAt = iso(r.closed_at);
    return {
      id: String(r.id),
      automationId: String(r.automation_id),
      automationName:
        r.automation_name === null || r.automation_name === undefined
          ? ''
          : json<I18nText>(r.automation_name, String(r.automation_name)),
      rid: (r.rid ?? null) as Rid | null,
      title: String(r.title ?? ''),
      severity: String(r.severity) as Severity,
      status: String(r.status) as AlertStatus,
      snapshot: json<Record<string, unknown>>(r.snapshot, {}),
      hits: Number(r.hits),
      raisedAt: new Date(Number(r.raised_at)).toISOString(),
      ...(r.acked_by !== null ? {ackedBy: String(r.acked_by)} : {}),
      ...(closedAt ? {closedAt} : {}),
      ...(r.recommendation_id !== null
        ? {recommendationId: String(r.recommendation_id)}
        : {}),
    };
  }

  async insertOpen(tenantId: string, a: NewAlert): Promise<boolean> {
    try {
      await this.db
        .prepare(
          `INSERT INTO sit_alert (id, tenant_id, automation_id, rid, title,
             severity, status, snapshot, hits, raised_at)
           VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, 1, ?)`,
        )
        .bind(
          a.id,
          tenantId,
          a.automationId,
          a.rid,
          a.title,
          a.severity,
          JSON.stringify(a.snapshot),
          a.raisedAt,
        )
        .run();
      return true;
    } catch (e) {
      if (/UNIQUE/i.test(e instanceof Error ? e.message : String(e))) {
        return false;
      }
      throw e;
    }
  }

  async latestFor(
    tenantId: string,
    automationId: string,
    rid: Rid | null,
  ): Promise<LatestAlert | null> {
    const r = await this.db
      .prepare(
        `SELECT id, status, closed_at FROM sit_alert
         WHERE tenant_id = ? AND automation_id = ? AND rid IS ?
         ORDER BY (status <> 'CLOSED') DESC, raised_at DESC, id DESC LIMIT 1`,
      )
      .bind(tenantId, automationId, rid)
      .first<Row>();
    if (!r) return null;
    return {
      id: String(r.id),
      status: String(r.status) as AlertStatus,
      closedAt: num(r.closed_at),
    };
  }

  async hit(
    tenantId: string,
    id: string,
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE sit_alert SET hits = hits + 1, snapshot = ?
         WHERE tenant_id = ? AND id = ?`,
      )
      .bind(JSON.stringify(snapshot), tenantId, id)
      .run();
  }

  async get(tenantId: string, id: string): Promise<AlertDto | null> {
    const r = await this.db
      .prepare(`${ALERT_SELECT} WHERE a.tenant_id = ? AND a.id = ?`)
      .bind(tenantId, id)
      .first<Row>();
    return r ? this.map(r) : null;
  }

  async list(tenantId: string, filter: AlertFilter = {}): Promise<AlertDto[]> {
    const where = ['a.tenant_id = ?'];
    const args: unknown[] = [tenantId];
    if (filter.status) {
      where.push('a.status = ?');
      args.push(filter.status);
    }
    if (filter.severity) {
      where.push('a.severity = ?');
      args.push(filter.severity);
    }
    if (filter.rid) {
      where.push('a.rid = ?');
      args.push(filter.rid);
    }
    const rows = await all(
      this.db
        .prepare(
          `${ALERT_SELECT} WHERE ${where.join(' AND ')}
           ORDER BY a.raised_at DESC, a.id DESC LIMIT ?`,
        )
        .bind(...args, filter.limit ?? 50),
    );
    return rows.map(r => this.map(r));
  }

  async listActive(tenantId: string, limit: number): Promise<AlertDto[]> {
    const rows = await all(
      this.db
        .prepare(
          `${ALERT_SELECT} WHERE a.tenant_id = ? AND a.status <> 'CLOSED'
           ORDER BY ${SEVERITY_ORDER} DESC, a.raised_at DESC, a.id DESC LIMIT ?`,
        )
        .bind(tenantId, limit),
    );
    return rows.map(r => this.map(r));
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: AlertStatus,
    patch: {ackedBy?: string; closedAt?: number},
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE sit_alert SET status = ?,
           acked_by = COALESCE(?, acked_by), closed_at = COALESCE(?, closed_at)
         WHERE tenant_id = ? AND id = ?`,
      )
      .bind(status, patch.ackedBy ?? null, patch.closedAt ?? null, tenantId, id)
      .run();
  }

  async linkRecommendation(
    tenantId: string,
    id: string,
    recommendationId: string,
  ): Promise<boolean> {
    const r = await this.db
      .prepare(
        'UPDATE sit_alert SET recommendation_id = ? WHERE tenant_id = ? AND id = ?',
      )
      .bind(recommendationId, tenantId, id)
      .run();
    return changes(r) > 0;
  }

  async deleteClosedBefore(ts: number): Promise<number> {
    const r = await this.db
      .prepare(
        "DELETE FROM sit_alert WHERE status = 'CLOSED' AND closed_at < ?",
      )
      .bind(ts)
      .run();
    return changes(r);
  }
}

/** sit_recommendation. */
export class D1RecommendationRepository implements RecommendationRepository {
  constructor(private readonly db: D1Database) {}

  async upsert(
    tenantId: string,
    dto: RecommendationSummary,
    at: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sit_recommendation (id, tenant_id, status, data, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET status = excluded.status,
           data = excluded.data, updated_at = excluded.updated_at
         WHERE sit_recommendation.tenant_id = excluded.tenant_id`,
      )
      .bind(dto.id, tenantId, dto.status, JSON.stringify(dto), at)
      .run();
  }

  async listByStatus(
    tenantId: string,
    status: string,
    limit: number,
  ): Promise<RecommendationSummary[]> {
    const rows = await all(
      this.db
        .prepare(
          `SELECT data FROM sit_recommendation WHERE tenant_id = ? AND status = ?
           ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .bind(tenantId, status, limit),
    );
    return rows.map(r => json<RecommendationSummary>(r.data, {} as never));
  }
}

/** sit_layout. */
export class D1LayoutRepository implements LayoutRepository {
  constructor(private readonly db: D1Database) {}

  async latest(tenantId: string): Promise<CockpitLayout | null> {
    const r = await this.db
      .prepare(
        `SELECT layout FROM sit_layout WHERE tenant_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(tenantId)
      .first<Row>();
    return r ? json<CockpitLayout | null>(r.layout, null) : null;
  }

  async save(
    tenantId: string,
    layout: CockpitLayout,
    at: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sit_layout (tenant_id, id, layout, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, id) DO UPDATE SET layout = excluded.layout,
           updated_at = excluded.updated_at`,
      )
      .bind(tenantId, layout.id, JSON.stringify(layout), at)
      .run();
  }
}

/** sit_dead_letter (tenant column added by 0002). */
export class D1DeadLetterRepository implements DeadLetterRepository {
  constructor(private readonly db: D1Database) {}

  async insert(letters: NewDeadLetter[]): Promise<void> {
    if (letters.length === 0) return;
    await this.db.batch(
      letters.map(l =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO sit_dead_letter
               (id, queue, tenant_id, body, attempts, received_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            l.id,
            l.queue,
            l.tenantId,
            JSON.stringify(l.body ?? null),
            l.attempts,
            l.receivedAt,
          ),
      ),
    );
  }

  async list(
    tenantId: string,
    opts: {
      queue?: string;
      pendingOnly?: boolean;
      ids?: string[];
      limit: number;
      oldestFirst?: boolean;
    },
  ): Promise<DeadLetterDto[]> {
    const base = ['(tenant_id = ? OR tenant_id IS NULL)'];
    const args: unknown[] = [tenantId];
    if (opts.queue) {
      base.push('queue = ?');
      args.push(opts.queue);
    }
    if (opts.pendingOnly) base.push('replayed_at IS NULL');
    const dir = opts.oldestFirst ? 'ASC' : 'DESC';
    const run = async (where: string[], extra: unknown[]) =>
      all(
        this.db
          .prepare(
            `SELECT * FROM sit_dead_letter WHERE ${where.join(' AND ')}
             ORDER BY received_at ${dir}, id ${dir} LIMIT ?`,
          )
          .bind(...args, ...extra, opts.limit),
      );
    let rows: Row[];
    if (opts.ids) {
      rows = [];
      for (const part of chunks(opts.ids)) {
        rows.push(
          ...(await run(
            [...base, `id IN (${part.map(() => '?').join(',')})`],
            part,
          )),
        );
      }
      rows = rows.slice(0, opts.limit);
    } else {
      rows = await run(base, []);
    }
    return rows.map(r => {
      const replayedAt = iso(r.replayed_at);
      return {
        id: String(r.id),
        queue: String(r.queue),
        body: json<unknown>(r.body, null),
        attempts: Number(r.attempts),
        receivedAt: new Date(Number(r.received_at)).toISOString(),
        ...(replayedAt ? {replayedAt} : {}),
      };
    });
  }

  async markReplayed(ids: string[], at: number): Promise<void> {
    for (const part of chunks(ids)) {
      await this.db
        .prepare(
          `UPDATE sit_dead_letter SET replayed_at = ?
           WHERE id IN (${part.map(() => '?').join(',')})`,
        )
        .bind(at, ...part)
        .run();
    }
  }
}

/** sit_processed_event (system table, keyed by globally unique event id). */
export class D1ProcessedEventRepository implements ProcessedEventRepository {
  constructor(private readonly db: D1Database) {}

  async has(eventId: string): Promise<boolean> {
    const r = await this.db
      .prepare('SELECT 1 AS x FROM sit_processed_event WHERE event_id = ?')
      .bind(eventId)
      .first<Row>();
    return r !== null;
  }

  async add(eventId: string, at: number): Promise<void> {
    await this.db
      .prepare(
        'INSERT OR IGNORE INTO sit_processed_event (event_id, processed_at) VALUES (?, ?)',
      )
      .bind(eventId, at)
      .run();
  }

  async deleteOlderThan(ts: number): Promise<number> {
    const r = await this.db
      .prepare('DELETE FROM sit_processed_event WHERE processed_at < ?')
      .bind(ts)
      .run();
    return changes(r);
  }
}

/** sit_usage_day (system table; usage is account-wide). */
export class D1UsageDayRepository implements UsageDayRepository {
  constructor(private readonly db: D1Database) {}

  async save(
    day: string,
    used: Partial<Record<UsageResource, number>>,
  ): Promise<void> {
    const entries = Object.entries(used);
    if (entries.length === 0) return;
    await this.db.batch(
      entries.map(([resource, n]) =>
        this.db
          .prepare(
            `INSERT INTO sit_usage_day (day, resource, used) VALUES (?, ?, ?)
             ON CONFLICT (day, resource) DO UPDATE SET used = excluded.used`,
          )
          .bind(day, resource, n),
      ),
    );
  }
}

/** Builds every repository over one D1 database. */
export function createD1Repositories(db: D1Database): SituationRepositories {
  return {
    kpis: new D1KpiRepository(db),
    metrics: new D1MetricRepository(db),
    automations: new D1AutomationRepository(db),
    alerts: new D1AlertRepository(db),
    recommendations: new D1RecommendationRepository(db),
    layouts: new D1LayoutRepository(db),
    deadLetters: new D1DeadLetterRepository(db),
    processedEvents: new D1ProcessedEventRepository(db),
  };
}
