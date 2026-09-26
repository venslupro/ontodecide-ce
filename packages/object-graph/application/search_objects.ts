/**
 * @fileoverview SearchObjects: title search, optionally within one type.
 */

import {clampLimit} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {ObjectDto} from '../contract';
import type {AppDeps} from './ports';
import {requireRole, toObjectDto} from './support';

/** Use case: search objects by title. */
export class SearchObjects {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    q: string,
    opts: {type?: string; limit?: number} = {},
  ): Promise<ObjectDto[]> {
    requireRole(ctx, 'Viewer');
    const text = (q ?? '').trim();
    if (!text) return [];
    const model = await this.d.models.get(ctx);
    const rows = await this.d.reader.search(
      ctx.tenantId,
      text.slice(0, 100),
      opts.type,
      clampLimit(opts.limit ?? 20),
    );
    return rows.map(o => toObjectDto(ctx, model, o));
  }
}
