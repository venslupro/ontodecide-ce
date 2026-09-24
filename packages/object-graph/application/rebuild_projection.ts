/**
 * @fileoverview RebuildProjection: enqueues graph-sync chunks for every
 * graph-projected object and link of the tenant.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {GraphSyncMsg} from '../contract';
import type {AppDeps} from './ports';
import {indexedValues, linkProjected, requireRole} from './support';

const OBJECT_PAGE = 500;
const UPSERTS_PER_MSG = 100;
const LINKS_PER_MSG = 200;

/** Use case: rebuild the Neo4j projection from D1 (Admin). */
export class RebuildProjection {
  constructor(private readonly d: AppDeps) {}

  async handle(ctx: CallCtx): Promise<{queued: number}> {
    requireRole(ctx, 'Admin');
    const tenantId = ctx.tenantId;
    const model = await this.d.models.get(ctx);
    const types = Object.values(model.objectTypes)
      .filter(t => t.graphProjected)
      .map(t => t.apiName);
    const linkTypes = Object.keys(model.linkTypes).filter(l =>
      linkProjected(model, l),
    );
    let queued = 0;
    const flush = async (msgs: GraphSyncMsg[]) => {
      if (!msgs.length) return;
      await this.d.outbox.publishGraphSync(msgs);
      queued += msgs.length;
    };

    let afterRid = '';
    while (types.length) {
      const page = await this.d.reader.pageByTypes(
        tenantId,
        types,
        afterRid,
        OBJECT_PAGE,
      );
      if (!page.length) break;
      const msgs: GraphSyncMsg[] = [];
      for (let i = 0; i < page.length; i += UPSERTS_PER_MSG) {
        msgs.push({
          tenantId,
          links: [],
          upserts: page.slice(i, i + UPSERTS_PER_MSG).map(o => ({
            rid: o.rid,
            type: o.type,
            title: o.title,
            idx: indexedValues(model.objectTypes[o.type], o.props),
          })),
        });
      }
      await flush(msgs);
      afterRid = page[page.length - 1].rid;
      if (page.length < OBJECT_PAGE) break;
    }

    let after: {type: string; src: string; dst: string} | null = null;
    while (linkTypes.length) {
      const page = await this.d.reader.pageLinks(
        tenantId,
        linkTypes,
        after,
        LINKS_PER_MSG * 5,
      );
      if (!page.length) break;
      const msgs: GraphSyncMsg[] = [];
      for (let i = 0; i < page.length; i += LINKS_PER_MSG) {
        msgs.push({
          tenantId,
          upserts: [],
          links: page.slice(i, i + LINKS_PER_MSG).map(l => ({
            type: l.type,
            src: l.src,
            dst: l.dst,
            weight: l.weight ?? null,
            op: 'merge' as const,
          })),
        });
      }
      await flush(msgs);
      const last = page[page.length - 1];
      after = {type: last.type, src: last.src, dst: last.dst};
      if (page.length < LINKS_PER_MSG * 5) break;
    }
    return {queued};
  }
}
