/**
 * @fileoverview domain-events delivery: the queue publisher (splits events
 * larger than 64 KB by rid) and the cross-workspace outbox store used by
 * the redelivery cron (SystemRepository).
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {DomainEventMsg, QueueSender} from '@ontodecide/shared-kernel';
import {
  SystemRepository,
  hasTombstone,
  sweepTombstones,
} from '@ontodecide/shared-kernel/d1';
import type {
  EventPublisher,
  OutboxRelayStore,
  PendingEvent,
} from '../application/ports';
import {splitEvent} from '../domain';

/** Publishes domain events to the `domain-events` queue. */
export class QueueEventPublisher implements EventPublisher {
  constructor(
    private readonly queue: Pick<QueueSender<DomainEventMsg>, 'send'>,
    private readonly maxBytes?: number,
  ) {}

  async publish(msg: DomainEventMsg): Promise<void> {
    for (const part of splitEvent(msg, this.maxBytes)) {
      await this.queue.send(part);
    }
  }
}

/** Outbox rows of every workspace (cron only). */
export class D1OutboxRelay
  extends SystemRepository
  implements OutboxRelayStore
{
  async oldest(olderThanMs: number, limit: number): Promise<PendingEvent[]> {
    const {results} = await this.sql(
      `SELECT tenant_id, id, payload FROM domain_event
       WHERE occurred_at <= ?1 ORDER BY occurred_at, id LIMIT ?2`,
      olderThanMs,
      limit,
    ).all<{tenant_id: string; id: string; payload: string}>();
    const out: PendingEvent[] = [];
    for (const r of results) {
      const msg = parseJson<DomainEventMsg | null>(r.payload, null);
      if (msg) out.push({tid: r.tenant_id, id: r.id, msg});
      // An undecodable row would block the queue head forever.
      else await this.delete(r.tenant_id, r.id);
    }
    return out;
  }

  async delete(tid: string, id: string): Promise<void> {
    await this.sql(
      'DELETE FROM domain_event WHERE tenant_id = ?1 AND id = ?2',
      tid,
      id,
    ).run();
  }

  isTombstoned(tid: string): Promise<boolean> {
    return hasTombstone(this.db, tid);
  }

  sweepTombstones(nowMs: number): Promise<void> {
    return sweepTombstones(this.db, nowMs);
  }
}
