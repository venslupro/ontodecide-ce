/**
 * @fileoverview Domain event envelope (used for outbox rows and queue
 * messages) and attribute provenance.
 */

import {ulid} from './ids';

/** Envelope shared by outbox rows and queue messages. */
export interface DomainEvent<T = unknown> {
  /** ULID; subscribers use it for idempotency. */
  eventId: string;
  /** Event type, e.g. `ObjectsUpserted`. */
  type: string;
  tenantId: string;
  occurredAt: string;
  correlationId: string;
  /** Ontology version the payload was produced against. */
  schemaVersion: string;
  payload: T;
}

/** Creates a new event envelope. */
export function makeEvent<T>(
  type: string,
  tenantId: string,
  payload: T,
  opts: {correlationId?: string; schemaVersion?: string; now?: Date} = {},
): DomainEvent<T> {
  const now = opts.now ?? new Date();
  return {
    eventId: ulid(now.getTime()),
    type,
    tenantId,
    occurredAt: now.toISOString(),
    correlationId: opts.correlationId ?? 'none',
    schemaVersion: opts.schemaVersion ?? '0',
    payload,
  };
}

/** Where an attribute value came from. */
export interface Provenance {
  sourceId: string;
  datasetTxn: string;
  recordRef: string;
  ingestedAt: string;
  /** 0–1. */
  confidence: number;
  /** Source-supplied timestamp, used by latest-wins conflict resolution. */
  sourceTs?: string;
  /** Source priority, used by source-priority conflict resolution. */
  priority?: number;
}
