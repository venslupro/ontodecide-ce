/**
 * @fileoverview Lineage: current provenance and overwritten history of each
 * visible property.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import type {LineageDto} from '../contract';
import {hiddenPropNames} from '../domain';
import type {AppDeps} from './ports';
import {requireRole, ridInTenant} from './support';

/** Use case: property lineage of one object. */
export class GetLineage {
  constructor(private readonly d: AppDeps) {}

  async handle(ctx: CallCtx, rid: Rid): Promise<LineageDto> {
    requireRole(ctx, 'Viewer');
    const obj = ridInTenant(ctx, rid)
      ? await this.d.reader.getByRid(ctx.tenantId, rid)
      : null;
    if (!obj) throw new AppError('OBJECT_NOT_FOUND');
    const model = await this.d.models.get(ctx);
    const hidden = hiddenPropNames(ctx, model.objectTypes[obj.type]);
    const names = new Set([
      ...Object.keys(obj.props),
      ...Object.keys(obj.provenance),
      ...Object.keys(obj.history),
    ]);
    const props: LineageDto['props'] = {};
    for (const name of [...names].sort()) {
      if (hidden.has(name)) continue;
      props[name] = {
        value: obj.props[name] ?? null,
        current: obj.provenance[name] ?? null,
        history: obj.history[name] ?? [],
      };
    }
    return {rid: obj.rid, props};
  }
}
