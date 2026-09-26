/**
 * @fileoverview In-memory queues with batching, retries and dead-lettering,
 * mirroring Cloudflare Queues semantics closely enough for integration tests.
 */

import type {
  QueueBatch,
  QueueMessage,
  QueueSender,
} from '@ontodecide/shared-kernel';

interface Envelope {
  id: string;
  body: unknown;
  attempts: number;
}

/** Consumer settings (as in wrangler queue consumer config). */
export interface ConsumerConfig {
  handler: (batch: QueueBatch<unknown>) => Promise<void>;
  maxBatchSize?: number;
  maxRetries?: number;
  /** Queue receiving messages that exhausted retries. */
  deadLetterQueue?: string;
}

let seq = 0;

/** A set of named queues shared by every service in a test. */
export class QueueBus {
  readonly queues = new Map<string, Envelope[]>();
  readonly sent = new Map<string, number>();

  /** Producer binding for a queue. */
  sender<T = unknown>(name: string): QueueSender<T> & Queue<T> {
    const push = (body: unknown): void => {
      // Queue messages are structured-cloned on send.
      const list = this.queues.get(name) ?? [];
      list.push({id: `m${++seq}`, body: structuredClone(body), attempts: 0});
      this.queues.set(name, list);
      this.sent.set(name, (this.sent.get(name) ?? 0) + 1);
    };
    const sender = {
      send: async (body: T) => push(body),
      sendBatch: async (messages: Iterable<{body: T}>) => {
        for (const m of messages) push(m.body);
      },
    };
    return sender as unknown as QueueSender<T> & Queue<T>;
  }

  /** Number of pending messages in a queue. */
  size(name: string): number {
    return this.queues.get(name)?.length ?? 0;
  }

  /** Pending message bodies (without consuming them). */
  peek(name: string): unknown[] {
    return (this.queues.get(name) ?? []).map(e => e.body);
  }

  /**
   * Delivers messages to consumers until every queue with a consumer is
   * empty (or `maxRounds` is reached). Returns the number of batches.
   */
  async drain(
    consumers: Record<string, ConsumerConfig>,
    maxRounds = 200,
  ): Promise<number> {
    let batches = 0;
    for (let round = 0; round < maxRounds; round++) {
      const name = Object.keys(consumers).find(q => this.size(q) > 0);
      if (!name) return batches;
      const cfg = consumers[name];
      const list = this.queues.get(name)!;
      const taken = list.splice(0, cfg.maxBatchSize ?? 10);
      const outcome = new Map<string, 'ack' | 'retry'>();
      const messages: QueueMessage<unknown>[] = taken.map(e => ({
        id: e.id,
        body: e.body,
        attempts: e.attempts + 1,
        ack: () => void outcome.set(e.id, 'ack'),
        retry: () => void outcome.set(e.id, 'retry'),
      }));
      const batch: QueueBatch<unknown> = {
        queue: name,
        messages,
        ackAll: () => taken.forEach(e => outcome.set(e.id, 'ack')),
        retryAll: () => taken.forEach(e => outcome.set(e.id, 'retry')),
      };
      let failed = false;
      try {
        await cfg.handler(batch);
      } catch {
        failed = true;
      }
      batches++;
      for (const e of taken) {
        const o = outcome.get(e.id) ?? (failed ? 'retry' : 'ack');
        if (o === 'ack') continue;
        e.attempts++;
        if (e.attempts > (cfg.maxRetries ?? 3)) {
          if (cfg.deadLetterQueue) {
            const dlq = this.queues.get(cfg.deadLetterQueue) ?? [];
            dlq.push({...e, attempts: e.attempts});
            this.queues.set(cfg.deadLetterQueue, dlq);
          }
        } else {
          list.push(e);
        }
      }
    }
    return batches;
  }
}
