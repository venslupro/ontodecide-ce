/**
 * @fileoverview Entity-resolution merge suggestions: list and resolve.
 * Accepting writes an alias for B's key, moves B's links to A and deletes B.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {GraphSyncMsg, MergeSuggestionDto} from '../contract';
import {linkKey} from '../domain';
import type {StoredLink} from '../domain';
import type {AppDeps, OutboxEvent, WriteOp} from './ports';
import {graphSyncEvent, linkProjected, requireRole} from './support';
import {keyAliasSource} from './upsert_objects';

/** Use case: list merge suggestions (Modeler+). */
export class ListMergeSuggestions {
  constructor(private readonly d: AppDeps) {}

  handle(ctx: CallCtx): Promise<MergeSuggestionDto[]> {
    requireRole(ctx, 'Modeler');
    return this.d.suggestions.list(ctx.tenantId, 200);
  }
}

/** Use case: accept or reject a merge suggestion (Modeler+). */
export class ResolveMergeSuggestion {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    id: string,
    accept: boolean,
  ): Promise<MergeSuggestionDto> {
    requireRole(ctx, 'Modeler');
    const s = await this.d.suggestions.get(ctx.tenantId, id);
    if (!s) throw new AppError('NOT_FOUND', 'Merge suggestion not found');
    if (s.status !== 'OPEN') {
      throw new AppError('INVALID_TRANSITION', `Suggestion is ${s.status}`);
    }
    const tenantId = ctx.tenantId;
    if (!accept) {
      await this.d.writer.commit([
        {kind: 'resolveSuggestion', tenantId, id, status: 'REJECTED'},
      ]);
      return {...s, status: 'REJECTED'};
    }
    const objs = await this.d.reader.getByRids(tenantId, [s.ridA, s.ridB]);
    const a = objs.find(o => o.rid === s.ridA);
    const b = objs.find(o => o.rid === s.ridB);
    if (!a || !b) {
      throw new AppError('CONFLICT', 'One of the objects no longer exists');
    }
    const model = await this.d.models.get(ctx);
    const bLinks = await this.d.reader.links(tenantId, [b.rid], {
      direction: 'both',
    });
    const moved = new Map<string, StoredLink>();
    for (const l of bLinks) {
      const m: StoredLink = {
        ...l,
        src: l.src === b.rid ? a.rid : l.src,
        dst: l.dst === b.rid ? a.rid : l.dst,
      };
      if (m.src !== m.dst) moved.set(linkKey(m), m);
    }
    const now = this.d.clock.now();
    const ops: WriteOp[] = [
      {
        kind: 'alias',
        tenantId,
        sourceId: keyAliasSource(tenantId, b.type),
        externalKey: b.primaryKey,
        rid: a.rid,
        replace: true,
      },
      {kind: 'moveLinks', tenantId, from: b.rid, to: a.rid},
      {kind: 'clearIndex', tenantId, rid: b.rid},
      {kind: 'deleteObject', tenantId, rid: b.rid},
      {kind: 'resolveSuggestion', tenantId, id, status: 'ACCEPTED'},
    ];
    const sync: Omit<GraphSyncMsg, 'tenantId'> = {
      upserts: [],
      links: [
        ...bLinks.map(l => ({...l, op: 'delete' as const})),
        ...[...moved.values()].map(l => ({...l, op: 'merge' as const})),
      ]
        .filter(l => linkProjected(model, l.type))
        .map(l => ({
          type: l.type,
          src: l.src,
          dst: l.dst,
          weight: l.weight ?? null,
          op: l.op,
        })),
    };
    const events: OutboxEvent[] = sync.links.length
      ? [graphSyncEvent(tenantId, now, sync)]
      : [];
    for (const event of events) ops.push({kind: 'outbox', event});
    await this.d.writer.commit(ops);
    try {
      await this.d.outbox.dispatch(events, this.d.clock.now());
    } catch (e) {
      this.d.logger.warn('outbox dispatch failed; cron will retry', {
        useCase: 'ResolveMergeSuggestion',
        error: String(e),
      });
    }
    return {...s, status: 'ACCEPTED'};
  }
}
