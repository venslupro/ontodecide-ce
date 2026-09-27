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

/**
 * Logical queue names (详细设计 6.4.2). Deployed queues are named
 * {project}-{env}-<name>, e.g. ontodecide-prd-domain-events.
 */
export const QUEUES = {
  domainEvents: 'domain-events',
  deadLetter: 'dead-letter',
} as const;

/** Logical queue name. */
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Maps a deployed queue name back to its logical name. */
export function baseQueueName(name: string): string {
  const logical = Object.values(QUEUES).find(
    q => name === q || name.endsWith(`-${q}`),
  );
  return logical ?? name;
}

/** Retry delay for attempt n (1-based): 2^n seconds, capped at 60. */
export function backoffSeconds(attempts: number): number {
  return Math.min(60, 2 ** Math.max(1, attempts));
}
