/**
 * @fileoverview upsertBatch use case (详细设计 6.11.3): read existing objects
 * by primary key in one query → latest-wins merge → props_hash → one D1
 * batch with single-statement writes for objects, index, links and one
 * aggregated outbox row → deliver and delete the outbox row.
 */

import {AppError, newRid} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import {GRAPH_LIMITS} from '../contract/types';
import type {UpsertCmd, WriteResult} from '../contract/types';
import {
  indexEntries,
  linkKey,
  objectKey,
  planChanges,
  planUpsert,
  propsHash,
} from '../domain';
import type {GraphDeps, HashedObject} from './ports';
import {deliver, ensureNotTombstoned, outboxRow} from './support';

/** Writes ≤ 100 mapped rows of an import job. */
export async function upsertBatch(
  deps: GraphDeps,
  ctx: CallCtx,
  cmd: {jobId: string; seq: number; cmds: UpsertCmd[]},
): Promise<WriteResult> {
  if (!cmd || typeof cmd.jobId !== 'string' || !cmd.jobId) {
    throw new AppError('VALIDATION_FAILED', 'jobId is required');
  }
  if (!Array.isArray(cmd.cmds) || cmd.cmds.length > GRAPH_LIMITS.batchMax) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A batch holds at most ${GRAPH_LIMITS.batchMax} rows`,
    );
  }
  const empty: WriteResult = {
    upserted: 0,
    skipped: 0,
    linksWritten: 0,
    rejected: [],
  };
  const repos = deps.repos(ctx.tid);
  const schema = await deps.schema.get(ctx);
  const nowMs = deps.clock.now().getTime();

  const keys = new Map<string, {type: string; primaryKey: string}>();
  const addKey = (type: string, primaryKey: string): void => {
    const pk = String(primaryKey ?? '').trim();
    if (pk) keys.set(objectKey(type, pk), {type, primaryKey: pk});
  };
  for (const c of cmd.cmds) {
    addKey(c.type, c.primaryKey);
    for (const l of c.links ?? []) addKey(l.toType, l.toKey);
  }
  const [counts, existing] = await Promise.all([
    repos.reader.counts(),
    repos.reader.findByKeys([...keys.values()]),
  ]);
  ensureNotTombstoned(counts.tombstoned);
  if (!cmd.cmds.length) return empty;

  const sourceKeys = new Set(
    cmd.cmds.map(c => objectKey(c.type, String(c.primaryKey ?? '').trim())),
  );
  const sources = existing
    .filter(o => sourceKeys.has(objectKey(o.type, o.primaryKey)))
    .map(o => o.rid);
  const existingLinks = new Map<string, number | null>();
  if (cmd.cmds.some(c => c.links?.length) && sources.length) {
    for (const l of await repos.traversal.linksFrom(sources)) {
      existingLinks.set(linkKey(l.src, l.type, l.dst), l.weight);
    }
  }

  const plan = planUpsert({
    schema,
    cmds: cmd.cmds,
    existing,
    existingLinks,
    counts,
    caps: deps.caps,
    jobId: cmd.jobId,
    nowMs,
    newRid: type => newRid(type, nowMs),
  });
  const objects: HashedObject[] = await Promise.all(
    plan.objects.map(async o => ({
      ...o,
      hash: await propsHash(o.state.props),
      index: indexEntries(schema.objectTypes[o.type], o.state.props),
    })),
  );
  const changes = planChanges(plan);
  const outbox = changes.length
    ? outboxRow(ctx.tid, nowMs, 'ObjectsUpserted', changes, {
        jobId: cmd.jobId,
      })
    : null;
  if (!objects.length && !plan.links.length) {
    return {
      upserted: plan.upserted,
      skipped: plan.skipped,
      linksWritten: 0,
      rejected: plan.rejected,
    };
  }

  const commit = await repos.writer.commitUpsert({
    objects,
    links: plan.links,
    caps: deps.caps,
    outbox,
    nowMs,
  });

  // Reconcile with what the guarded statements actually wrote (a
  // concurrent batch may have used the remaining capacity).
  const result: WriteResult = {
    upserted: plan.upserted,
    skipped: plan.skipped,
    linksWritten: commit.links.size,
    rejected: [...plan.rejected],
  };
  for (const o of plan.objects) {
    if (commit.objects.has(o.rid)) continue;
    result.upserted -= o.rows.length;
    if (o.isNew) {
      for (const row of o.rows) {
        result.rejected.push({row, code: 'OBJECT_LIMIT'});
      }
    } else {
      result.skipped += o.rows.length;
    }
  }
  for (const l of plan.links) {
    if (l.isNew && !commit.links.has(linkKey(l.src, l.type, l.dst))) {
      result.rejected.push({row: l.row, code: 'LINK_LIMIT', detail: l.type});
    }
  }
  result.rejected.sort((a, b) => a.row - b.row);

  if (outbox) {
    const linkSources = new Set<string>();
    for (const l of plan.links) {
      if (commit.links.has(linkKey(l.src, l.type, l.dst))) {
        linkSources.add(l.src);
      }
    }
    const written = outbox.msg.changes.filter(
      c => commit.objects.has(c.rid) || linkSources.has(c.rid as Rid),
    );
    // The stored row holds the same subset (filtered inside the batch); no
    // row was stored when nothing was written.
    if (written.length) {
      await deliver(deps, repos, {
        id: outbox.id,
        msg: {...outbox.msg, changes: written},
      });
    }
  }
  return result;
}
