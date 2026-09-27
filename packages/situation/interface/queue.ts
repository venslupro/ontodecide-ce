/**
 * @fileoverview domain-events consumer: groups messages by workspace and
 * hands each group to its room. Transient failures retry with backoff;
 * malformed messages and permanent errors are acknowledged and logged.
 */

import {
  AppError,
  type DomainEventMsg,
  type ErrorCode,
  type Logger,
  type QueueBatch,
  type QueueMessage,
  backoffSeconds,
} from '@ontodecide/shared-kernel';
import type {SituationRoomApi} from '../application';
import type {RoomResolver} from './rpc';

const PERMANENT: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
]);

/** Structural check of a domain-events message. */
export function isDomainEvent(body: unknown): body is DomainEventMsg {
  const m = body as Partial<DomainEventMsg> | null;
  return (
    !!m &&
    typeof m === 'object' &&
    typeof m.eventId === 'string' &&
    m.eventId.length > 0 &&
    typeof m.tid === 'string' &&
    m.tid.length > 0 &&
    Array.isArray(m.changes) &&
    m.changes.every(
      c =>
        !!c &&
        typeof c.rid === 'string' &&
        typeof c.type === 'string' &&
        Array.isArray(c.changed),
    )
  );
}

/** Builds the queue handler. */
export function createDomainEventsConsumer(deps: {
  rooms: RoomResolver<Pick<SituationRoomApi, 'applyEvents'>>;
  logger: Logger;
}): (batch: QueueBatch<unknown>) => Promise<void> {
  const {rooms, logger} = deps;
  return async batch => {
    const groups = new Map<
      string,
      {msgs: QueueMessage<unknown>[]; events: DomainEventMsg[]}
    >();
    for (const m of batch.messages) {
      if (!isDomainEvent(m.body)) {
        logger.warn('situation.event_invalid', {messageId: m.id});
        m.ack();
        continue;
      }
      const g = groups.get(m.body.tid) ?? {msgs: [], events: []};
      g.msgs.push(m);
      g.events.push(m.body);
      groups.set(m.body.tid, g);
    }
    await Promise.all(
      [...groups].map(async ([tid, g]) => {
        try {
          const r = await rooms(tid).applyEvents(tid, g.events);
          for (const m of g.msgs) m.ack();
          if (r.dropped) {
            logger.info('situation.events_dropped', {tid, n: g.events.length});
          }
        } catch (e) {
          const err = AppError.from(e);
          if (PERMANENT.has(err.code)) {
            logger.warn('situation.events_rejected', {tid, code: err.code});
            for (const m of g.msgs) m.ack();
            return;
          }
          logger.warn('situation.events_retry', {tid, code: err.code});
          for (const m of g.msgs) {
            m.retry({delaySeconds: backoffSeconds(m.attempts)});
          }
        }
      }),
    );
  };
}
