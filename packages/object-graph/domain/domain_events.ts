/**
 * @fileoverview Aggregated domain events (详细设计 6.4.2): one outbox row per
 * commit; a message larger than 64 KB is split by rid into several messages
 * with distinct event ids (`{id}#{n}`) so consumers can deduplicate each.
 */

import {CE_LIMITS, jsonBytes} from '@ontodecide/shared-kernel';
import type {DomainEventMsg} from '@ontodecide/shared-kernel';

/**
 * Splits an event into messages of at most `maxBytes` (JSON UTF-8). A
 * single change is never split further.
 */
export function splitEvent(
  msg: DomainEventMsg,
  maxBytes: number = CE_LIMITS.maxEventBytes,
): DomainEventMsg[] {
  if (jsonBytes(msg) <= maxBytes) return [msg];
  const base = jsonBytes({...msg, eventId: `${msg.eventId}#0000`, changes: []});
  const parts: DomainEventMsg['changes'][] = [];
  let cur: DomainEventMsg['changes'] = [];
  let size = base;
  for (const c of msg.changes) {
    const n = jsonBytes(c) + 1;
    if (cur.length && size + n > maxBytes) {
      parts.push(cur);
      cur = [];
      size = base;
    }
    cur.push(c);
    size += n;
  }
  if (cur.length) parts.push(cur);
  return parts.map((changes, i) => ({
    ...msg,
    eventId: `${msg.eventId}#${i + 1}`,
    changes,
  }));
}
