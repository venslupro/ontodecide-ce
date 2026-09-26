/**
 * @fileoverview OnOntologyPublished: rebuilds og_prop_index for object types
 * whose index plan changed and records the indexed model version.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import {parseJson} from '@ontodecide/shared-kernel';
import type {AppDeps, WriteOp} from './ports';
import {requireRole} from './support';

/** og_meta key of the stored index plan (`{type: props[]}`). */
export const META_INDEX_PLAN = 'indexPlan';
/** og_meta key of the last indexed model version. */
export const META_MODEL_VERSION = 'modelVersion';

const PAGE = 200;
const OPS_PER_COMMIT = 200;

/** Use case: react to a published ontology version. */
export class OnOntologyPublished {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    evt: {api: string; version: string; breaking: boolean},
  ): Promise<{reindexed: number}> {
    requireRole(ctx, 'Modeler');
    const tenantId = ctx.tenantId;
    const model = await this.d.models.get(ctx, {refresh: true});
    const stored = parseJson<Record<string, string[]>>(
      await this.d.meta.get(tenantId, META_INDEX_PLAN),
      {},
    );
    const plan: Record<string, string[]> = {};
    for (const t of Object.values(model.objectTypes)) {
      plan[t.apiName] = [...t.indexedProps].sort();
    }
    let reindexed = 0;
    for (const type of new Set([
      ...Object.keys(stored),
      ...Object.keys(plan),
    ])) {
      const before = new Set(stored[type] ?? []);
      const after = new Set(plan[type] ?? []);
      const removed = [...before].filter(p => !after.has(p));
      const added = [...after].filter(p => !before.has(p));
      if (!removed.length && !added.length) continue;
      if (removed.length) {
        await this.d.writer.commit(
          removed.map(prop => ({kind: 'clearIndexProp', tenantId, type, prop})),
        );
      }
      if (!added.length) continue;
      let afterRid = '';
      for (;;) {
        const page = await this.d.reader.pageByTypes(
          tenantId,
          [type],
          afterRid,
          PAGE,
        );
        if (!page.length) break;
        let ops: WriteOp[] = [];
        for (const o of page) {
          for (const prop of added) {
            const value = o.props[prop];
            if (value === undefined || value === null) continue;
            ops.push({
              kind: 'setIndex',
              tenantId,
              type,
              rid: o.rid,
              prop,
              value,
            });
            if (ops.length >= OPS_PER_COMMIT) {
              await this.d.writer.commit(ops);
              ops = [];
            }
          }
        }
        if (ops.length) await this.d.writer.commit(ops);
        reindexed += page.length;
        afterRid = page[page.length - 1].rid;
        if (page.length < PAGE) break;
      }
    }
    await this.d.writer.commit([
      {
        kind: 'meta',
        tenantId,
        key: META_INDEX_PLAN,
        value: JSON.stringify(plan),
      },
      {kind: 'meta', tenantId, key: META_MODEL_VERSION, value: model.version},
    ]);
    this.d.logger.info('ontology published; index rebuilt', {
      useCase: 'OnOntologyPublished',
      api: evt.api,
      version: evt.version,
      reindexed,
    });
    return {reindexed};
  }
}
