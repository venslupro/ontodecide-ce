/**
 * @fileoverview Platform-neutral queue types. They are structurally
 * compatible with Cloudflare `Queue` and `MessageBatch`, so application
 * code depends on these and tests can supply in-memory fakes.
 */

/** Producer side of a queue. */
export interface QueueSender<T> {
  send(body: T, opts?: {delaySeconds?: number}): Promise<void>;
  sendBatch(
    messages: Iterable<{body: T; delaySeconds?: number}>,
  ): Promise<void>;
}

/** One delivered message. */
export interface QueueMessage<T> {
  readonly id: string;
  readonly body: T;
  readonly attempts: number;
  ack(): void;
  retry(opts?: {delaySeconds?: number}): void;
}

/** A batch delivered to a consumer. */
export interface QueueBatch<T> {
  readonly queue: string;
  readonly messages: readonly QueueMessage<T>[];
  ackAll(): void;
  retryAll(opts?: {delaySeconds?: number}): void;
}

/** Queue names without environment suffix. */
export const QUEUES = {
  ingest: 'ingest',
  objectWrites: 'object-writes',
  graphSync: 'graph-sync',
  situationEvents: 'situation-events',
  decisionJobs: 'decision-jobs',
} as const;

/** Logical queue name. */
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Splits a queue name into its base name and whether it is a DLQ. */
export function baseQueueName(name: string): {name: string; dlq: boolean} {
  let n = name;
  const dlq = n.endsWith('-dlq');
  if (dlq) n = n.slice(0, -4);
  return {name: n, dlq};
}

/** Retry delay for attempt n (1-based): 2^n seconds, capped at 60. */
export function backoffSeconds(attempts: number): number {
  return Math.min(60, 2 ** Math.max(1, attempts));
}
