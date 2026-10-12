/**
 * @fileoverview Use case: clear the workspace's business data (objects,
 * links, property index, undelivered outbox rows) when the user resets the
 * workspace to its blank state. The action audit is kept and gains one
 * `$clearWorkspace` entry recording who cleared how much.
 */

import {AppError, actorLabel, ulid} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {ClearedGraph} from '../contract/types';
import type {GraphDeps} from './ports';
import {ensureNotTombstoned} from './support';

/** Principals that may clear a workspace. */
const CLEAR_ACTORS = ['owner', 'admin'];

/** Clears the workspace's objects and links; see the file overview. */
export async function clearWorkspace(
  deps: GraphDeps,
  ctx: CallCtx,
): Promise<ClearedGraph> {
  const actor = actorLabel(ctx);
  if (!CLEAR_ACTORS.includes(actor)) {
    throw new AppError('FORBIDDEN', 'This principal cannot clear a workspace');
  }
  const repos = deps.repos(ctx.tid);
  ensureNotTombstoned((await repos.reader.counts()).tombstoned);
  const nowMs = deps.clock.now().getTime();
  const cleared = await repos.writer.clearAll({
    id: ulid(nowMs),
    actor,
    actorUserId: ctx.actor.role === 'admin' ? (ctx.actor.userId ?? null) : null,
    executedAt: nowMs,
  });
  deps.logger.info('workspace cleared', {tid: ctx.tid, ...cleared});
  return cleared;
}
