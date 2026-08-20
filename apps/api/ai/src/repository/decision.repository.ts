/**
 * Decision repository: persists AI outputs in D1 so they can be rendered
 * in the dashboard history view and reused by the budget manager.
 */
import {and, count, desc, eq} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/d1';
import {decisions} from '@ontodecide/shared/db';

export interface DecisionRecord {
  id: string;
  tenantId: string;
  kind: 'scenario' | 'recommendation' | 'agent_plan';
  topic: string;
  provider: string;
  model: string | null;
  promptHash: string;
  payload: string;
  neuronCost: number;
  metadata: string | null;
}

export interface IDecisionRepository {
  save(record: DecisionRecord): Promise<void>;
  listForTenant(
    tenantId: string,
    opts?: {kind?: string; offset?: number; limit?: number},
  ): Promise<{total: number; items: DecisionRecord[]}>;
  findByHash(tenantId: string, promptHash: string): Promise<DecisionRecord | null>;
}

type DecisionRow = typeof decisions.$inferSelect;

export class D1DecisionRepository implements IDecisionRepository {
  private readonly db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  public async save(record: DecisionRecord): Promise<void> {
    await this.db.insert(decisions).values({
      id: record.id,
      tenant_id: record.tenantId,
      kind: record.kind,
      topic: record.topic,
      provider: record.provider,
      model: record.model,
      prompt_hash: record.promptHash,
      payload: record.payload,
      neuron_cost: record.neuronCost,
      metadata: record.metadata,
    }).run();
  }

  public async listForTenant(
      tenantId: string,
      opts: {kind?: string; offset?: number; limit?: number} = {},
  ): Promise<{total: number; items: DecisionRecord[]}> {
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const where = opts.kind ?
      and(eq(decisions.tenant_id, tenantId), eq(decisions.kind, opts.kind)) :
      eq(decisions.tenant_id, tenantId);
    const countRow = await this.db.select({total: count()})
        .from(decisions)
        .where(where ?? undefined)
        .get();
    const rows = await this.db.select()
        .from(decisions)
        .where(where ?? undefined)
        .orderBy(desc(decisions.created_at))
        .limit(limit)
        .offset(offset)
        .all();
    return {
      total: countRow?.total ?? 0,
      items: rows.map((row) => fromRow(row)),
    };
  }

  public async findByHash(
      tenantId: string,
      promptHash: string,
  ): Promise<DecisionRecord | null> {
    const row = await this.db.select()
        .from(decisions)
        .where(
            and(
                eq(decisions.tenant_id, tenantId),
                eq(decisions.prompt_hash, promptHash),
            ),
        )
        .orderBy(desc(decisions.created_at))
        .limit(1)
        .get();
    return row ? fromRow(row) : null;
  }
}

function fromRow(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as DecisionRecord['kind'],
    topic: row.topic,
    provider: row.provider,
    model: row.model,
    promptHash: row.prompt_hash,
    payload: row.payload,
    neuronCost: row.neuron_cost,
    metadata: row.metadata,
  };
}
