/**
 * @fileoverview ModelProvider over OntologyRpc.getActiveModel with an
 * isolate-local cache per tenant (by version for writes, TTL for reads).
 */

import type {CompiledModel, OntologyRpc} from '@ontodecide/ontology/contract';
import {systemClock} from '@ontodecide/shared-kernel';
import type {CallCtx, Clock} from '@ontodecide/shared-kernel';
import type {ModelProvider} from '../application/ports';

/** Cached model provider. */
export class OntologyModelProvider implements ModelProvider {
  private readonly cache = new Map<
    string,
    {model: CompiledModel; at: number; accepted: Set<string>}
  >();

  constructor(
    private readonly ontology: Pick<OntologyRpc, 'getActiveModel'>,
    private readonly clock: Clock = systemClock,
    private readonly ttlMs = 60_000,
  ) {}

  async get(
    ctx: CallCtx,
    opts: {expectedVersion?: string; refresh?: boolean} = {},
  ): Promise<CompiledModel> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(ctx.tenantId);
    const fresh = hit !== undefined && now - hit.at < this.ttlMs;
    if (hit && !opts.refresh) {
      const expected = opts.expectedVersion;
      if (expected === undefined) {
        if (fresh) return hit.model;
      } else if (
        hit.model.version === expected ||
        (fresh && hit.accepted.has(expected))
      ) {
        // A producer version that differs from the model version (e.g. a
        // schema version) is accepted for the TTL to avoid refetching per
        // message.
        return hit.model;
      }
    }
    const model = await this.ontology.getActiveModel(ctx);
    const accepted = new Set<string>();
    if (opts.expectedVersion !== undefined) accepted.add(opts.expectedVersion);
    this.cache.set(ctx.tenantId, {model, at: now, accepted});
    return model;
  }
}
