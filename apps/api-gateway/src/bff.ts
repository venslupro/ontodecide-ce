/**
 * @fileoverview Backend-for-frontend aggregations (详细设计 6.11.7):
 * `GET /me` and `GET /situation/overview` merge the personal quotas that
 * each service counts locally (修订说明书 12.7: no callback into
 * identity-access); `GET /me/export` streams JSON Lines chunk by chunk.
 */

import {
  CE_LIMITS,
  mergeQuotas,
  type CallCtx,
  type Clock,
  type Logger,
  type QuotaItem,
  type Quotas,
} from '@ontodecide/shared-kernel';
import type {Env} from './env';
import {json} from './http';

async function settle<T>(
  p: Promise<T>,
  fallback: T,
  logger: Logger,
  what: string,
): Promise<T> {
  try {
    return await p;
  } catch (err) {
    logger.warn('bff part failed', {
      what,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    return fallback;
  }
}

/**
 * Collects quota items from identity (sessions), integration (import
 * rows, mapping drafts), decision (AI recommendations) and object-graph
 * stats (objects / links against 300 / 900). A failing source reads 0/0.
 */
export async function collectQuotas(
  env: Env,
  ctx: CallCtx,
  clock: Clock,
  logger: Logger,
): Promise<Quotas> {
  const none: QuotaItem[] = [];
  const [identity, integration, decision, stats] = await Promise.all([
    settle(env.IDENTITY.usage(ctx), none, logger, 'identity.usage'),
    settle(env.INTEGRATION.usage(ctx), none, logger, 'integration.usage'),
    settle(env.DECISION.usage(ctx), none, logger, 'decision.usage'),
    settle(env.OBJECTS.stats(ctx), null, logger, 'objects.stats'),
  ]);
  const graph: QuotaItem[] = stats
    ? [
        {key: 'objects', used: stats.objects, limit: CE_LIMITS.objects},
        {key: 'links', used: stats.links, limit: CE_LIMITS.links},
      ]
    : [];
  return mergeQuotas(
    [...identity, ...integration, ...decision, ...graph],
    clock.now(),
  );
}

/** GET /me: `MeDto & {quotas}`. */
export async function getMeBff(
  env: Env,
  ctx: CallCtx,
  clock: Clock,
  logger: Logger,
): Promise<Response> {
  const [me, quotas] = await Promise.all([
    env.IDENTITY.getMe(ctx),
    collectQuotas(env, ctx, clock, logger),
  ]);
  return json({...me, quotas});
}

/** Number of pending recommendations shown on the cockpit. */
export const PENDING_RECS = 5;

/** GET /situation/overview: overview + pending recommendations + quotas. */
export async function overviewBff(
  env: Env,
  ctx: CallCtx,
  range: '24h' | '7d',
  clock: Clock,
  logger: Logger,
): Promise<Response> {
  const [overview, recs, quotas] = await Promise.all([
    env.SITUATION.overview(ctx, {range}),
    settle(
      env.DECISION.listRecommendations(
        ctx,
        {status: 'Proposed'},
        {limit: PENDING_RECS},
      ),
      {items: [], nextCursor: null},
      logger,
      'decision.listRecommendations',
    ),
    collectQuotas(env, ctx, clock, logger),
  ]);
  return json({...overview, pendingRecommendations: recs.items, quotas});
}

/** Media type of the export stream. */
export const JSONL_MEDIA_TYPE = 'application/jsonl';

/**
 * GET /me/export: loops IDENTITY.exportChunk into a ReadableStream. The
 * first chunk is fetched before responding so an early error is still a
 * Problem Details response; later failures abort the stream.
 */
export async function exportBff(
  env: Env,
  ctx: CallCtx,
  clock: Clock,
): Promise<Response> {
  const encoder = new TextEncoder();
  const line = (text: string): Uint8Array =>
    encoder.encode(text && !text.endsWith('\n') ? `${text}\n` : text);
  const first = await env.IDENTITY.exportChunk(ctx, null);
  let cursor = first.nextCursor;
  let pending: Uint8Array | null = line(first.text);
  const body = new ReadableStream<Uint8Array>({
    // Each pull enqueues at least one non-empty chunk or closes the stream
    // (a pull that does neither would stall it).
    async pull(controller) {
      for (;;) {
        let bytes: Uint8Array;
        if (pending) {
          bytes = pending;
          pending = null;
        } else if (cursor) {
          const next = await env.IDENTITY.exportChunk(ctx, cursor);
          cursor = next.nextCursor;
          bytes = line(next.text);
        } else {
          controller.close();
          return;
        }
        if (bytes.byteLength) {
          controller.enqueue(bytes);
          if (!cursor) controller.close();
          return;
        }
      }
    },
  });
  const day = clock.now().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': `${JSONL_MEDIA_TYPE}; charset=utf-8`,
      'content-disposition': `attachment; filename="ontodecide-export-${day}.jsonl"`,
    },
  });
}
