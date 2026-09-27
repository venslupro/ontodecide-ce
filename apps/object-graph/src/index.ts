/**
 * @fileoverview Worker entry point of object-graph: the ObjectGraphRpc and
 * TenantLifecycle WorkerEntrypoints plus the 15-minute outbox cron. The only
 * file importing cloudflare:workers.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {ObjectGraphRpc as Contract} from '@ontodecide/object-graph/contract';
import type {TenantLifecycleRpc} from '@ontodecide/shared-kernel';
import type {Env} from './env';
import {createService} from './service';

type Service = ReturnType<typeof createService>;

let cache: {env: Env; svc: Service} | undefined;

function svc(env: Env): Service {
  if (cache?.env !== env) cache = {env, svc: createService(env)};
  return cache.svc;
}

/** Business RPC bound by other Workers as `OBJECTS`. */
export class ObjectGraphRpc extends WorkerEntrypoint<Env> implements Contract {
  getObject(...a: Parameters<Contract['getObject']>) {
    return svc(this.env).rpc.getObject(...a);
  }
  getObjects(...a: Parameters<Contract['getObjects']>) {
    return svc(this.env).rpc.getObjects(...a);
  }
  listObjects(...a: Parameters<Contract['listObjects']>) {
    return svc(this.env).rpc.listObjects(...a);
  }
  patchObject(...a: Parameters<Contract['patchObject']>) {
    return svc(this.env).rpc.patchObject(...a);
  }
  getLinks(...a: Parameters<Contract['getLinks']>) {
    return svc(this.env).rpc.getLinks(...a);
  }
  impactSubgraph(...a: Parameters<Contract['impactSubgraph']>) {
    return svc(this.env).rpc.impactSubgraph(...a);
  }
  stats(...a: Parameters<Contract['stats']>) {
    return svc(this.env).rpc.stats(...a);
  }
  upsertBatch(...a: Parameters<Contract['upsertBatch']>) {
    return svc(this.env).rpc.upsertBatch(...a);
  }
  applyAction(...a: Parameters<Contract['applyAction']>) {
    return svc(this.env).rpc.applyAction(...a);
  }
  listActionLog(...a: Parameters<Contract['listActionLog']>) {
    return svc(this.env).rpc.listActionLog(...a);
  }
}

/** Lifecycle entry point, bound only to identity-access as `LC_OBJECTS`. */
export class TenantLifecycle
  extends WorkerEntrypoint<Env>
  implements TenantLifecycleRpc
{
  exportTenant(tid: string, cursor: string | null) {
    return svc(this.env).lifecycle.exportTenant(tid, cursor);
  }
  purgeTenant(tid: string, maxRows: number) {
    return svc(this.env).lifecycle.purgeTenant(tid, maxRows);
  }
  countTenant(tid: string) {
    return svc(this.env).lifecycle.countTenant(tid);
  }
  tenantStats(tids: string[]) {
    return svc(this.env).lifecycle.tenantStats!(tids);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
  scheduled: (evt, env, ctx) =>
    ctx.waitUntil(svc(env).scheduled(evt.cron, new Date(evt.scheduledTime))),
} satisfies ExportedHandler<Env>;
