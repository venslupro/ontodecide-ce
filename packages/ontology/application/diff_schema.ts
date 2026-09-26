/**
 * @fileoverview Diff use case: draft vs current published version.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import type {DiffReport} from '../contract';
import {diffSchemas} from '../domain';
import type {OntologyDeps} from './ports';

/** Compares the draft with the current published version. */
export class DiffHandler {
  constructor(private readonly deps: OntologyDeps) {}

  async execute(ctx: CallCtx, api: string): Promise<DiffReport> {
    const draft = await this.deps.repo.getDraft(ctx.tenantId, api);
    if (!draft) throw new AppError('NOT_FOUND', `No draft for schema ${api}`);
    const current = await this.deps.repo.getCurrent(ctx.tenantId, api);
    return diffSchemas(current, draft.definition);
  }
}
