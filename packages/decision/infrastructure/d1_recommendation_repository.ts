/**
 * @fileoverview D1 repository for dec_recommendation.
 */

import {parseJson, type Rid} from '@ontodecide/shared-kernel';
import type {RecStatus} from '../contract';
import type {
  RecommendationFilter,
  RecommendationRecord,
  RecommendationRepository,
} from '../application';

interface Row {
  id: string;
  tenant_id: string;
  alert_id: string | null;
  scenario_id: string | null;
  focus: string;
  status: string;
  summary: string | null;
  rationale: string | null;
  actions: string | null;
  evidence: string | null;
  risks: string | null;
  confidence: number | null;
  model: string | null;
  degraded: number;
  simulation: string | null;
  locale: string;
  requested_by: string | null;
  approved_by: string | null;
  decided_at: number | null;
  reject_reason: string | null;
  feedback: string | null;
  outcome: string | null;
  executed_at: number | null;
  created_at: number;
  expires_at: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();
const ms = (s: string | undefined): number | null =>
  s ? new Date(s).getTime() : null;
const json = (v: unknown): string | null =>
  v === undefined || v === null ? null : JSON.stringify(v);

function toRecord(r: Row): RecommendationRecord {
  const simulation = parseJson<RecommendationRecord['simulation'] | null>(
    r.simulation,
    null,
  );
  const feedback = parseJson<RecommendationRecord['feedback'] | null>(
    r.feedback,
    null,
  );
  const outcome = parseJson<RecommendationRecord['outcome'] | null>(
    r.outcome,
    null,
  );
  return {
    id: r.id,
    tenantId: r.tenant_id,
    status: r.status as RecStatus,
    focus: r.focus as Rid,
    ...(r.alert_id ? {alertId: r.alert_id} : {}),
    ...(r.scenario_id ? {scenarioId: r.scenario_id} : {}),
    summary: r.summary ?? '',
    rationale: r.rationale ?? '',
    actions: parseJson(r.actions, []),
    evidence: parseJson(r.evidence, []),
    risks: parseJson(r.risks, []),
    confidence: r.confidence ?? 0,
    model: r.model ?? '',
    degraded: r.degraded === 1,
    ...(simulation ? {simulation} : {}),
    ...(r.approved_by ? {approvedBy: r.approved_by} : {}),
    ...(r.decided_at !== null ? {decidedAt: iso(r.decided_at)} : {}),
    ...(r.reject_reason ? {rejectReason: r.reject_reason} : {}),
    ...(feedback ? {feedback} : {}),
    ...(outcome ? {outcome} : {}),
    locale: r.locale,
    ...(r.requested_by ? {requestedBy: r.requested_by} : {}),
    ...(r.executed_at !== null ? {executedAt: iso(r.executed_at)} : {}),
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
  };
}

/** dec_recommendation repository. */
export class D1RecommendationRepository implements RecommendationRepository {
  constructor(private readonly db: D1Database) {}

  async insert(rec: RecommendationRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO dec_recommendation
          (id, tenant_id, alert_id, scenario_id, focus, status, summary, rationale, actions, evidence,
           risks, confidence, model, degraded, simulation, locale, requested_by, approved_by, decided_at,
           reject_reason, feedback, outcome, executed_at, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        rec.id,
        rec.tenantId,
        rec.alertId ?? null,
        rec.scenarioId ?? null,
        rec.focus,
        rec.status,
        rec.summary,
        rec.rationale,
        JSON.stringify(rec.actions),
        JSON.stringify(rec.evidence),
        JSON.stringify(rec.risks),
        rec.confidence,
        rec.model,
        rec.degraded ? 1 : 0,
        json(rec.simulation),
        rec.locale,
        rec.requestedBy ?? null,
        rec.approvedBy ?? null,
        ms(rec.decidedAt),
        rec.rejectReason ?? null,
        json(rec.feedback),
        json(rec.outcome),
        ms(rec.executedAt),
        ms(rec.createdAt),
        ms(rec.expiresAt),
      )
      .run();
  }

  async get(
    tenantId: string,
    id: string,
  ): Promise<RecommendationRecord | null> {
    const row = await this.db
      .prepare(
        'SELECT * FROM dec_recommendation WHERE tenant_id = ? AND id = ?',
      )
      .bind(tenantId, id)
      .first<Row>();
    return row ? toRecord(row) : null;
  }

  async list(
    tenantId: string,
    f: RecommendationFilter,
  ): Promise<RecommendationRecord[]> {
    const where = ['tenant_id = ?'];
    const args: unknown[] = [tenantId];
    if (f.status) {
      where.push('status = ?');
      args.push(f.status);
    }
    if (f.focus) {
      where.push('focus = ?');
      args.push(f.focus);
    }
    const {results} = await this.db
      .prepare(
        `SELECT * FROM dec_recommendation WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(...args, f.limit)
      .all<Row>();
    return results.map(toRecord);
  }

  async update(
    rec: RecommendationRecord,
    expected: RecStatus,
  ): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE dec_recommendation SET
           status = ?, summary = ?, rationale = ?, actions = ?, evidence = ?, risks = ?, confidence = ?,
           model = ?, degraded = ?, simulation = ?, locale = ?, approved_by = ?, decided_at = ?,
           reject_reason = ?, feedback = ?, outcome = ?, executed_at = ?, expires_at = ?
         WHERE tenant_id = ? AND id = ? AND status = ?`,
      )
      .bind(
        rec.status,
        rec.summary,
        rec.rationale,
        JSON.stringify(rec.actions),
        JSON.stringify(rec.evidence),
        JSON.stringify(rec.risks),
        rec.confidence,
        rec.model,
        rec.degraded ? 1 : 0,
        json(rec.simulation),
        rec.locale,
        rec.approvedBy ?? null,
        ms(rec.decidedAt),
        rec.rejectReason ?? null,
        json(rec.feedback),
        json(rec.outcome),
        ms(rec.executedAt),
        ms(rec.expiresAt),
        rec.tenantId,
        rec.id,
        expected,
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async listExpired(
    now: number,
    limit: number,
  ): Promise<RecommendationRecord[]> {
    // System job across tenants; callers act with systemCtx(row.tenantId).
    const {results} = await this.db
      .prepare(
        `SELECT * FROM dec_recommendation
         WHERE status IN ('Draft', 'Proposed') AND expires_at <= ?
         ORDER BY expires_at LIMIT ?`,
      )
      .bind(now, limit)
      .all<Row>();
    return results.map(toRecord);
  }

  async listExecutedBefore(
    before: number,
    limit: number,
  ): Promise<RecommendationRecord[]> {
    // System job across tenants; uses ix_dec_rec_status (status, executed_at).
    const {results} = await this.db
      .prepare(
        `SELECT * FROM dec_recommendation
         WHERE status = 'Executed' AND executed_at <= ?
         ORDER BY executed_at LIMIT ?`,
      )
      .bind(before, limit)
      .all<Row>();
    return results.map(toRecord);
  }
}
