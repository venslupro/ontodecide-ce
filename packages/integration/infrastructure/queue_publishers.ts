/**
 * @fileoverview Queue producers for `ingest` and `object-writes`.
 */

import {jsonBytes} from '@ontodecide/shared-kernel';
import type {QueueSender} from '@ontodecide/shared-kernel';
import type {IngestPublisher, ObjectWritePublisher} from '../application';
import type {IngestMsg, ObjectWriteMsg} from '../contract';

/** Cloudflare Queues sendBatch limits. */
export const SEND_BATCH_MAX_MESSAGES = 100;
export const SEND_BATCH_MAX_BYTES = 250 * 1024;

/** Publishes ingest messages, grouping them into sendBatch calls. */
export class QueueIngestPublisher implements IngestPublisher {
  constructor(private readonly queue: QueueSender<IngestMsg>) {}

  async publish(msgs: IngestMsg[]): Promise<void> {
    let group: {body: IngestMsg}[] = [];
    let bytes = 0;
    for (const body of msgs) {
      const size = jsonBytes(body);
      if (
        group.length > 0 &&
        (group.length >= SEND_BATCH_MAX_MESSAGES ||
          bytes + size > SEND_BATCH_MAX_BYTES)
      ) {
        await this.queue.sendBatch(group);
        group = [];
        bytes = 0;
      }
      group.push({body});
      bytes += size;
    }
    if (group.length > 0) await this.queue.sendBatch(group);
  }
}

/** Publishes object-writes messages. */
export class QueueObjectWritePublisher implements ObjectWritePublisher {
  constructor(private readonly queue: QueueSender<ObjectWriteMsg>) {}

  async publish(msg: ObjectWriteMsg): Promise<void> {
    await this.queue.send(msg);
  }
}
