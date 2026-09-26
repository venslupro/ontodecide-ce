/**
 * @fileoverview D1 store for the LLM output cache (dec_llm_cache) and
 * daily usage accounting (dec_llm_usage).
 */

import type {LlmDayUsage, LlmStore} from '../application';

/** dec_llm_cache + dec_llm_usage. */
export class D1LlmStore implements LlmStore {
  constructor(private readonly db: D1Database) {}

  async getCached(
    hash: string,
    notBefore: number,
  ): Promise<{output: string; model: string} | null> {
    return this.db
      .prepare(
        'SELECT output, model FROM dec_llm_cache WHERE input_hash = ? AND created_at >= ?',
      )
      .bind(hash, notBefore)
      .first<{output: string; model: string}>();
  }

  async putCached(
    hash: string,
    output: string,
    model: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO dec_llm_cache (input_hash, output, model, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (input_hash) DO UPDATE SET output = excluded.output, model = excluded.model,
           created_at = excluded.created_at`,
      )
      .bind(hash, output, model, now)
      .run();
  }

  async purgeCache(before: number): Promise<number> {
    const res = await this.db
      .prepare('DELETE FROM dec_llm_cache WHERE created_at < ?')
      .bind(before)
      .run();
    return res.meta?.changes ?? 0;
  }

  async usage(
    day: string,
    tenantId: string,
    userId: string,
  ): Promise<LlmDayUsage> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(calls), 0) AS tenant_calls,
                COALESCE(SUM(CASE WHEN user_id = ? THEN calls ELSE 0 END), 0) AS user_calls
         FROM dec_llm_usage WHERE day = ? AND tenant_id = ?`,
      )
      .bind(userId, day, tenantId)
      .first<{tenant_calls: number; user_calls: number}>();
    return {
      userCalls: Number(row?.user_calls ?? 0),
      tenantCalls: Number(row?.tenant_calls ?? 0),
    };
  }

  async recordUsage(
    day: string,
    tenantId: string,
    userId: string,
    model: string,
    calls: number,
    neurons: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO dec_llm_usage (day, tenant_id, user_id, model, calls, neurons) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, tenant_id, user_id, model) DO UPDATE SET
           calls = calls + excluded.calls, neurons = neurons + excluded.neurons`,
      )
      .bind(day, tenantId, userId, model, calls, Math.round(neurons))
      .run();
  }
}
