/**
 * @fileoverview Loads the tenant's active model (memory → KV → D1 + compile)
 * and the GetActiveModel use case.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledModel} from '../contract';
import {mergeModel} from '../domain';
import type {OntologyDeps, SchemaRecord} from './ports';
import {compiledOf} from './support';

/** Builds and caches the merged model of a tenant. */
export class ActiveModelLoader {
  constructor(private readonly deps: OntologyDeps) {}

  /** Returns the active model, serving from cache when possible. */
  async load(tenantId: string): Promise<CompiledModel> {
    const cached = await this.deps.cache.getModel(tenantId);
    if (cached) return cached;
    const model = await this.build(
      tenantId,
      await this.deps.repo.listCurrent(tenantId),
    );
    this.deps.cache.putModel(tenantId, model);
    return model;
  }

  /** Merges the given current rows into a model (no cache access). */
  async build(
    tenantId: string,
    current: readonly SchemaRecord[],
  ): Promise<CompiledModel> {
    return mergeModel(tenantId, await Promise.all(current.map(compiledOf)));
  }
}

/** GetActiveModel: merged model of all published schemas (never fails when empty). */
export class GetActiveModelHandler {
  constructor(private readonly loader: ActiveModelLoader) {}

  execute(ctx: CallCtx): Promise<CompiledModel> {
    return this.loader.load(ctx.tenantId);
  }
}
