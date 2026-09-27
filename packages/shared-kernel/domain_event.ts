/**
 * @fileoverview The `domain-events` message (详细设计 6.4.2) and attribute
 * provenance.
 *
 * object-graph is the only producer: one committed write produces one outbox
 * row and one aggregated message (≤ 64 KB, split by rid when larger) that
 * carries only rids and changed property names. situation-awareness is the
 * only consumer and reads current values by rid.
 */

import type {Rid} from './ids';

/** Kinds of domain events. */
export type DomainEventKind =
  'ObjectsUpserted' | 'ObjectPatched' | 'ActionExecuted';

/** One changed object. */
export interface ObjectChangeRef {
  rid: Rid;
  type: string;
  changed: string[];
}

/** Message on the `domain-events` queue. */
export interface DomainEventMsg {
  /** Outbox row id; consumers deduplicate on it. */
  eventId: string;
  tid: string;
  /** Unix milliseconds. */
  occurredAt: number;
  kind: DomainEventKind;
  jobId?: string;
  actionLogId?: string;
  recommendationId?: string;
  changes: ObjectChangeRef[];
}

/** Where an attribute value came from: the import job and row. */
export interface Provenance {
  jobId: string;
  row: number;
  /** Unix milliseconds. */
  at: number;
}
