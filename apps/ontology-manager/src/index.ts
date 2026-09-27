/**
 * @fileoverview ontology-manager Worker entry point. The only file that
 * imports `cloudflare:workers`.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {DefByKind, DefKind} from '@ontodecide/ontology/contract';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {Env} from './env';
import {createService} from './service';

type Service = ReturnType<typeof createService>;

let cached: {env: Env; svc: Service} | undefined;

/** One service (and compiled-schema cache) per isolate and env. */
function svc(env: Env): Service {
  if (cached?.env !== env) cached = {env, svc: createService(env)};
  return cached.svc;
}

/** Business RPC entry point (`entrypoint: "OntologyRpc"`). */
export class OntologyRpc extends WorkerEntrypoint<Env> {
  getCompiledSchema(ctx: CallCtx) {
    return svc(this.env).rpc.getCompiledSchema(ctx);
  }
  getOntology(ctx: CallCtx) {
    return svc(this.env).rpc.getOntology(ctx);
  }
  getTemplateSeeds(templateId: string) {
    return svc(this.env).rpc.getTemplateSeeds(templateId);
  }
  listDefinitions<K extends DefKind>(ctx: CallCtx, kind: K) {
    return svc(this.env).rpc.listDefinitions(ctx, kind);
  }
  getDefinition<K extends DefKind>(ctx: CallCtx, kind: K, id: string) {
    return svc(this.env).rpc.getDefinition(ctx, kind, id);
  }
  putDefinition<K extends DefKind>(
    ctx: CallCtx,
    kind: K,
    id: string,
    def: DefByKind[K],
    ifMatch: number,
  ) {
    return svc(this.env).rpc.putDefinition(ctx, kind, id, def, ifMatch);
  }
  deleteDefinition(ctx: CallCtx, kind: DefKind, id: string, ifMatch: number) {
    return svc(this.env).rpc.deleteDefinition(ctx, kind, id, ifMatch);
  }
}

/** Lifecycle entry point (`entrypoint: "TenantLifecycle"`), bound only to identity-access. */
export class TenantLifecycle extends WorkerEntrypoint<Env> {
  exportTenant(tenantId: string, cursor: string | null) {
    return svc(this.env).lifecycle.exportTenant(tenantId, cursor);
  }
  purgeTenant(tenantId: string, maxRows: number) {
    return svc(this.env).lifecycle.purgeTenant(tenantId, maxRows);
  }
  countTenant(tenantId: string) {
    return svc(this.env).lifecycle.countTenant(tenantId);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
} satisfies ExportedHandler<Env>;
