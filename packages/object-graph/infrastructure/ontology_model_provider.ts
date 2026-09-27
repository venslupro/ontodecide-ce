/**
 * @fileoverview SchemaProvider over the `ONTOLOGY` service binding. The
 * compiled schema is memoized per call context object so one request never
 * asks ontology-manager twice (ontology-manager caches by (tid, etag)).
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledSchema, OntologyRpc} from '@ontodecide/ontology/contract';
import type {SchemaProvider} from '../application/ports';

/** Reads the compiled ontology through OntologyRpc. */
export class OntologySchemaProvider implements SchemaProvider {
  private readonly memo = new WeakMap<CallCtx, Promise<CompiledSchema>>();

  constructor(
    private readonly ontology: Pick<OntologyRpc, 'getCompiledSchema'>,
  ) {}

  get(ctx: CallCtx): Promise<CompiledSchema> {
    let p = this.memo.get(ctx);
    if (!p) {
      p = this.ontology.getCompiledSchema(ctx);
      this.memo.set(ctx, p);
      p.catch(() => this.memo.delete(ctx));
    }
    return p;
  }
}
