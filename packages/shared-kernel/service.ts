/**
 * @fileoverview Shape every deployable service exposes to its Worker entry
 * point (and to the in-process test harness).
 */

import type {QueueBatch} from './queue';

/** A service assembled from its composition root. */
export interface ServiceModule<Rpc> {
  /** Methods exposed through the WorkerEntrypoint (service binding RPC). */
  rpc: Rpc;
  /** Queue consumer. */
  queue?(batch: QueueBatch<unknown>): Promise<void>;
  /** Cron handler. */
  scheduled?(cron: string, now: Date): Promise<void>;
  /** HTTP handler (only services that receive forwarded fetches). */
  fetch?(request: Request): Promise<Response>;
}
