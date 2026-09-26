/**
 * @fileoverview GetObject / GetObjects: object detail with optional link
 * expansion (depth 1 or 2, neighbor summaries). Detail costs at most four
 * D1 queries: object, first-hop links, second-hop links, neighbor summaries.
 */

import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import type {LinkDto, ObjectDto, ObjectSummary} from '../contract';
import {linkKey} from '../domain';
import type {StoredLink} from '../domain';
import type {AppDeps} from './ports';
import {requireRole, ridInTenant, toObjectDto, visibleTitle} from './support';

/** Maximum neighbor summaries returned with an object. */
export const NEIGHBORS_MAX = 200;

/** Use case: load one object. */
export class GetObject {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    rid: Rid,
    opts: {expand?: 'links'; depth?: 1 | 2} = {},
  ): Promise<ObjectDto | null> {
    requireRole(ctx, 'Viewer');
    if (!ridInTenant(ctx, rid)) return null;
    const obj = await this.d.reader.getByRid(ctx.tenantId, rid);
    if (!obj) return null;
    const model = await this.d.models.get(ctx);
    const dto = toObjectDto(ctx, model, obj);
    if (opts.expand !== 'links' && !opts.depth) return dto;

    const depth = opts.depth === 2 ? 2 : 1;
    const links = new Map<string, LinkDto>();
    const addLinks = (edges: StoredLink[], from: ReadonlySet<Rid>) => {
      for (const e of edges) {
        const k = linkKey(e);
        if (links.has(k)) continue;
        links.set(k, {
          type: e.type,
          src: e.src,
          dst: e.dst,
          weight: e.weight ?? null,
          direction: from.has(e.src) ? 'out' : 'in',
        });
      }
    };
    const first = await this.d.reader.links(ctx.tenantId, [rid], {
      direction: 'both',
    });
    addLinks(first, new Set([rid]));
    const hop1 = new Set<Rid>();
    for (const e of first) hop1.add(e.src === rid ? e.dst : e.src);
    hop1.delete(rid);
    const neighborRids = new Set<Rid>(hop1);
    if (depth === 2 && hop1.size) {
      const frontier = [...hop1].slice(0, NEIGHBORS_MAX);
      const second = await this.d.reader.links(ctx.tenantId, frontier, {
        direction: 'both',
      });
      addLinks(second, new Set(frontier));
      for (const e of second) {
        for (const r of [e.src, e.dst]) {
          if (r !== rid && neighborRids.size < NEIGHBORS_MAX) {
            neighborRids.add(r);
          }
        }
      }
    }
    let neighbors: ObjectSummary[] = [];
    if (neighborRids.size) {
      neighbors = (
        await this.d.reader.summaries(ctx.tenantId, [...neighborRids])
      ).map(s => ({
        rid: s.rid,
        type: s.type,
        title: visibleTitle(ctx, model.objectTypes[s.type], s),
      }));
    }
    return {...dto, links: [...links.values()], neighbors};
  }
}

/** Use case: load several objects by RID (unknown RIDs are skipped). */
export class GetObjects {
  constructor(private readonly d: AppDeps) {}

  async handle(ctx: CallCtx, rids: Rid[]): Promise<ObjectDto[]> {
    requireRole(ctx, 'Viewer');
    const own = [...new Set(rids.filter(r => ridInTenant(ctx, r)))];
    if (!own.length) return [];
    const model = await this.d.models.get(ctx);
    const objs = await this.d.reader.getByRids(ctx.tenantId, own);
    const byRid = new Map(objs.map(o => [o.rid, o]));
    return own
      .map(r => byRid.get(r))
      .filter(o => o !== undefined)
      .map(o => toObjectDto(ctx, model, o));
  }
}
