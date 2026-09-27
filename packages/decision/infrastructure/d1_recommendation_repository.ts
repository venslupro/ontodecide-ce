/**
 * @fileoverview dec_recommendation repository (workspace-scoped). Every
 * state change is a conditional UPDATE, so concurrent decisions cannot both
 * succeed; the decision Idempotency-Key lives in the unique column
 * `decision_key` (no extra table).
 */

import {
  AppError,
  clampLimit,
  decodeCursor,
  encodeCursor,
  parseJson,
  type Locale,
  type PageRequest,
  type PageResult,
  type Rid,
} from '@ontodecide/shared-kernel';
import {TenantRepository} from '@ontodecide/shared-kernel/d1';
import type {RecStatus} from '../contract';
import type {DecisionClaim, RecommendationRepository} from '../application';
import type {RecRecord} from '../domain';

/** A dec_recommendation row. */
export interface RecRow {
  id: string;
  focus: string;
  alert_id: string | null;
  scenario_id: string | null;
  status: RecStatus;
  summary: string | null;
  rationale: string | null;
  locale: string | null;
  candidates: string;
  ranking: string;
  evidence: string | null;
  risks: string | null;
  simulation: string | null;
  confidence: number | null;
  ranked_by: 'ai' | 'rules';
  model: string | null;
  decision_key: string | null;
  decided_by: 'owner' | 'admin' | null;
  decided_at: number | null;
  reject_reason: string | null;
  execution: string | null;
  exec_attempts: number;
  created_at: number;
  expires_at: number;
  version: number;
}

const COLUMNS = `id, focus, alert_id, scenario_id, status, summary, rationale,
  locale, candidates, ranking, evidence, risks, simulation, confidence,
  ranked_by, model, decision_key, decided_by, decided_at, reject_reason,
  execution, exec_attempts, created_at, expires_at, version`;

/** Maps a row to a record. */
export function toRecord(r: RecRow): RecRecord {
  return {
    id: r.id,
    status: r.status,
    focus: r.focus as Rid,
    ...(r.alert_id ? {alertId: r.alert_id} : {}),
    ...(r.scenario_id ? {scenarioId: r.scenario_id} : {}),
    summary: r.summary ?? '',
    rationale: r.rationale ?? '',
    candidates: parseJson(r.candidates, []),
    ranking: parseJson(r.ranking, []),
    evidence: parseJson(r.evidence, []),
    risks: parseJson(r.risks, []),
    confidence: r.confidence ?? 0,
    rankedBy: r.ranked_by,
    ...(r.model ? {model: r.model} : {}),
    ...(r.simulation ? {simulation: parseJson(r.simulation, undefined)} : {}),
    ...(r.decided_by ? {decidedBy: r.decided_by} : {}),
    ...(r.decided_at !== null
      ? {decidedAt: new Date(r.decided_at).toISOString()}
      : {}),
    ...(r.reject_reason ? {rejectReason: r.reject_reason} : {}),
    ...(r.execution ? {execution: parseJson(r.execution, [])} : {}),
    locale: (r.locale ?? 'zh-CN') as Locale,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
    version: r.version,
    ...(r.decision_key ? {decisionKey: r.decision_key} : {}),
    execAttempts: r.exec_attempts,
  };
}

interface Cursor {
  c: number;
  i: string;
}

function isUniqueViolation(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(m);
}

/** D1 implementation of {@link RecommendationRepository}. */
export class D1RecommendationRepository
  extends TenantRepository
  implements RecommendationRepository
{
  async insert(rec: RecRecord): Promise<void> {
    await this.stmt(
      `INSERT INTO dec_recommendation
         (tenant_id, id, focus, alert_id, scenario_id, status, summary,
          rationale, locale, candidates, ranking, evidence, risks, simulation,
          confidence, ranked_by, model, created_at, expires_at, version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
               ?15, ?16, ?17, ?18, ?19, ?20)`,
      rec.id,
      rec.focus,
      rec.alertId ?? null,
      rec.scenarioId ?? null,
      rec.status,
      rec.summary,
      rec.rationale,
      rec.locale,
      JSON.stringify(rec.candidates),
      JSON.stringify(rec.ranking),
      JSON.stringify(rec.evidence),
      JSON.stringify(rec.risks),
      rec.simulation ? JSON.stringify(rec.simulation) : null,
      rec.confidence,
      rec.rankedBy,
      rec.model ?? null,
      Date.parse(rec.createdAt),
      Date.parse(rec.expiresAt),
      rec.version,
    ).run();
  }

  async get(id: string): Promise<RecRecord | null> {
    const row = await this.stmt(
      `SELECT ${COLUMNS} FROM dec_recommendation
       WHERE tenant_id = ?1 AND id = ?2`,
      id,
    ).first<RecRow>();
    return row ? toRecord(row) : null;
  }

  async list(
    q: {status?: RecStatus},
    page: PageRequest,
  ): Promise<PageResult<RecRecord>> {
    const limit = clampLimit(page.limit);
    const cur = decodeCursor<Cursor>(page.cursor);
    const {results} = await this.stmt(
      `SELECT ${COLUMNS} FROM dec_recommendation
       WHERE tenant_id = ?1
         AND (?2 IS NULL OR status = ?2)
         AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND id < ?4))
       ORDER BY created_at DESC, id DESC
       LIMIT ?5`,
      q.status ?? null,
      cur ? cur.c : null,
      cur ? cur.i : '',
      limit + 1,
    ).all<RecRow>();
    const items = results.slice(0, limit).map(toRecord);
    const last = results.length > limit ? results[limit - 1] : undefined;
    return {
      items,
      nextCursor: last ? encodeCursor({c: last.created_at, i: last.id}) : null,
    };
  }

  async expireDue(nowMs: number, id?: string): Promise<number> {
    const res = await this.stmt(
      `UPDATE dec_recommendation
       SET status = 'Expired', version = version + 1
       WHERE tenant_id = ?1 AND status = 'Proposed' AND expires_at <= ?2
         AND (?3 IS NULL OR id = ?3)`,
      nowMs,
      id ?? null,
    ).run();
    return res.meta.changes ?? 0;
  }

  async claimDecision(
    id: string,
    claim: DecisionClaim,
    nowMs: number,
  ): Promise<boolean> {
    try {
      const res = await this.stmt(
        `UPDATE dec_recommendation
         SET status = ?3, decision_key = ?4, decided_by = ?5, decided_at = ?6,
             reject_reason = ?7, version = version + 1
         WHERE tenant_id = ?1 AND id = ?2 AND status = 'Proposed'
           AND expires_at > ?8 AND decision_key IS NULL`,
        id,
        claim.status,
        claim.key,
        claim.decidedBy,
        claim.decidedAtMs,
        claim.rejectReason ?? null,
        nowMs,
      ).run();
      return (res.meta.changes ?? 0) === 1;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppError(
          'CONFLICT',
          'Idempotency-Key already used for another recommendation',
        );
      }
      throw e;
    }
  }

  async beginExecution(
    id: string,
    key: string,
    maxAttempts: number,
  ): Promise<boolean> {
    const res = await this.stmt(
      `UPDATE dec_recommendation
       SET status = 'Confirmed', exec_attempts = exec_attempts + 1,
           version = version + 1
       WHERE tenant_id = ?1 AND id = ?2 AND decision_key = ?3
         AND exec_attempts < ?4
         AND ((status = 'Confirmed' AND exec_attempts = 0)
              OR status = 'ExecFailed')`,
      id,
      key,
      maxAttempts,
    ).run();
    return (res.meta.changes ?? 0) === 1;
  }

  async finishExecution(
    id: string,
    status: 'Executed' | 'ExecFailed',
    execution: RecRecord['execution'],
  ): Promise<void> {
    await this.stmt(
      `UPDATE dec_recommendation
       SET status = ?3, execution = ?4, version = version + 1
       WHERE tenant_id = ?1 AND id = ?2 AND status = 'Confirmed'`,
      id,
      status,
      JSON.stringify(execution ?? []),
    ).run();
  }
}
