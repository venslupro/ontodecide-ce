/**
 * @fileoverview Outbox dispatcher: delivers domain_event rows to the
 * graph-sync and situation-events queues and marks them dispatched.
 */

import type {QueueSender} from '@ontodecide/shared-kernel';
import type {GraphSyncMsg, SituationEventMsg} from '../contract';
import type {Outbox, OutboxEvent} from '../application/ports';
import {chunks} from './rows';

/** Messages per sendBatch call (Cloudflare limit is 100 / 256 KB). */
const SEND_BATCH = 50;

/** D1 + Queues outbox. */
export class QueueOutbox implements Outbox {
  constructor(
    private readonly db: D1Database,
    private readonly graphSync: QueueSender<GraphSyncMsg>,
    private readonly situation: QueueSender<SituationEventMsg>,
  ) {}

  async dispatch(events: readonly OutboxEvent[], now: Date): Promise<void> {
    if (!events.length) return;
    const graph = events.filter(e => e.topic === 'graph-sync');
    const sit = events.filter(e => e.topic === 'situation-events');
    for (const part of chunks(graph, SEND_BATCH)) {
      await this.graphSync.sendBatch(
        part.map(e => ({body: e.payload as GraphSyncMsg})),
      );
    }
    for (const part of chunks(sit, SEND_BATCH)) {
      await this.situation.sendBatch(
        part.map(e => ({body: e.payload as SituationEventMsg})),
      );
    }
    const byTenant = new Map<string, string[]>();
    for (const e of events) {
      byTenant.set(e.tenantId, [...(byTenant.get(e.tenantId) ?? []), e.id]);
    }
    await this.db.batch(
      [...byTenant].map(([tenantId, ids]) =>
        this.db
          .prepare(
            `UPDATE domain_event SET dispatched_at = ?
             WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))`,
          )
          .bind(now.getTime(), tenantId, JSON.stringify(ids)),
      ),
    );
  }

  async redispatchPending(
    olderThan: number,
    now: Date,
    limit = 500,
  ): Promise<number> {
    // System maintenance scan across tenants (cron only).
    const {results} = await this.db
      .prepare(
        `SELECT id, tenant_id, type, topic, payload, occurred_at FROM domain_event
         WHERE dispatched_at IS NULL AND occurred_at < ?
         ORDER BY occurred_at LIMIT ?`,
      )
      .bind(olderThan, limit)
      .all<{
        id: string;
        tenant_id: string;
        type: string;
        topic: string;
        payload: string;
        occurred_at: number;
      }>();
    const events = results
      .filter(r => r.topic === 'graph-sync' || r.topic === 'situation-events')
      .map(
        r =>
          ({
            id: r.id,
            tenantId: r.tenant_id,
            type: r.type,
            topic: r.topic,
            payload: JSON.parse(r.payload),
            occurredAt: Number(r.occurred_at),
          }) as OutboxEvent,
      );
    await this.dispatch(events, now);
    return events.length;
  }

  async purgeDispatched(before: number): Promise<number> {
    const r = await this.db
      .prepare(
        'DELETE FROM domain_event WHERE dispatched_at IS NOT NULL AND dispatched_at < ?',
      )
      .bind(before)
      .run();
    return r.meta.changes ?? 0;
  }

  async publishGraphSync(msgs: readonly GraphSyncMsg[]): Promise<void> {
    for (const part of chunks(msgs, SEND_BATCH)) {
      await this.graphSync.sendBatch(part.map(body => ({body})));
    }
  }
}
