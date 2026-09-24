/**
 * @fileoverview Dead-letter use cases: store messages from every `*-dlq`
 * queue, list them and replay them to their original queue.
 */

import {
  AppError,
  type CallCtx,
  QUEUES,
  type QueueMessage,
  type QueueName,
  baseQueueName,
} from '@ontodecide/shared-kernel';
import type {DeadLetterDto} from '../contract';
import type {SituationDeps} from './deps';
import {requireRole} from './support';

/** Dead letters listed / replayed per call. */
export const DEAD_LETTER_PAGE = 200;

const QUEUE_NAMES = new Set<string>(Object.values(QUEUES));

/** Normalizes `ingest`, `ingest-dlq`, `ingest-dlq-staging` → `ingest`. */
export function logicalQueue(queue: string): QueueName {
  const {name} = baseQueueName(queue);
  if (!QUEUE_NAMES.has(name)) {
    throw new AppError('VALIDATION_FAILED', `Unknown queue ${queue}`);
  }
  return name as QueueName;
}

/** Extracts the tenant of a queue message body, if any. */
export function bodyTenant(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as {tenantId?: unknown; ctx?: {tenantId?: unknown}};
  if (typeof b.tenantId === 'string') return b.tenantId;
  if (typeof b.ctx?.tenantId === 'string') return b.ctx.tenantId;
  return null;
}

/** Stores dead-lettered messages (idempotent by message id). */
export class StoreDeadLetters {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    queue: string,
    messages: readonly QueueMessage<unknown>[],
  ): Promise<number> {
    const q = baseQueueName(queue).name;
    const at = this.deps.clock.now().getTime();
    await this.deps.repos.deadLetters.insert(
      messages.map(m => ({
        id: m.id,
        queue: q,
        tenantId: bodyTenant(m.body),
        body: m.body,
        attempts: m.attempts,
        receivedAt: at,
      })),
    );
    return messages.length;
  }
}

/** Lists dead letters of the caller's tenant (Admin). */
export class ListDeadLetters {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, queue?: string): Promise<DeadLetterDto[]> {
    requireRole(ctx, 'Admin');
    return this.deps.repos.deadLetters.list(ctx.tenantId, {
      ...(queue ? {queue: logicalQueue(queue)} : {}),
      limit: DEAD_LETTER_PAGE,
    });
  }
}

/** Sends pending dead letters back to their producer queue (Admin). */
export class ReplayDeadLetters {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    ctx: CallCtx,
    queue: string,
    ids?: string[],
  ): Promise<{replayed: number}> {
    requireRole(ctx, 'Admin');
    const q = logicalQueue(queue);
    const target = this.deps.replayTargets[q];
    if (!target) {
      throw new AppError('VALIDATION_FAILED', `No producer for queue ${q}`);
    }
    const letters = await this.deps.repos.deadLetters.list(ctx.tenantId, {
      queue: q,
      pendingOnly: true,
      oldestFirst: true,
      ...(ids ? {ids} : {}),
      limit: DEAD_LETTER_PAGE,
    });
    if (letters.length === 0) return {replayed: 0};
    await target.sendBatch(letters.map(l => ({body: l.body})));
    await this.deps.repos.deadLetters.markReplayed(
      letters.map(l => l.id),
      this.deps.clock.now().getTime(),
    );
    return {replayed: letters.length};
  }
}
