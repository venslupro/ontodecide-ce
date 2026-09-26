/**
 * @fileoverview Active-model provider over the ONTOLOGY binding with an
 * isolate-memory cache. Entries are keyed by tenant and revalidated after a
 * short TTL; the compiled model object is reused while its version is
 * unchanged so derived lookups stay warm.
 */

import type {CallCtx, Clock} from '@ontodecide/shared-kernel';
import type {CompiledModel, OntologyRpc} from '@ontodecide/ontology/contract';
import type {ModelProvider} from '../application';

/** Revalidation interval. */
export const MODEL_TTL_MS = 30_000;

function versionKey(m: CompiledModel): string {
  return `${m.version}|${m.hash}|${(m.schemas ?? []).map(s => `${s.apiName}@${s.version}`).join(',')}`;
}

/** Caches `ONTOLOGY.getActiveModel` per tenant and model version. */
export class CachedModelProvider implements ModelProvider {
  private readonly byTenant = new Map<
    string,
    {key: string; model: CompiledModel; at: number}
  >();

  constructor(
    private readonly ontology: Pick<OntologyRpc, 'getActiveModel'>,
    private readonly clock: Clock,
    private readonly ttlMs = MODEL_TTL_MS,
  ) {}

  async get(ctx: CallCtx): Promise<CompiledModel> {
    const now = this.clock.now().getTime();
    const hit = this.byTenant.get(ctx.tenantId);
    if (hit && now - hit.at < this.ttlMs) return hit.model;
    const fresh = await this.ontology.getActiveModel(ctx);
    const key = versionKey(fresh);
    const model = hit && hit.key === key ? hit.model : fresh;
    if (this.byTenant.size > 100) this.byTenant.clear();
    this.byTenant.set(ctx.tenantId, {key, model, at: now});
    return model;
  }

  /** Drops cached models (e.g. after a publish). */
  invalidate(tenantId?: string): void {
    if (tenantId) this.byTenant.delete(tenantId);
    else this.byTenant.clear();
  }
}
