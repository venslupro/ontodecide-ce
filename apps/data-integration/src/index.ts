/**
 * @fileoverview Worker entry of data-integration: the IntegrationRpc and
 * TenantLifecycle entrypoints (service binding RPC). No queues, no cron.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {IntegrationRpc as Contract} from '@ontodecide/integration/contract';
import type {Env} from './env';
import {createService} from './service';

let cache: {env: Env; svc: ServiceModule<Contract>} | undefined;

function svc(env: Env): ServiceModule<Contract> {
  if (cache?.env !== env) cache = {env, svc: createService(env)};
  return cache.svc;
}

/** Business RPC surface (bound by api-gateway as INTEGRATION). */
export class IntegrationRpc extends WorkerEntrypoint<Env> implements Contract {
  createImport(...a: Parameters<Contract['createImport']>) {
    return svc(this.env).rpc.createImport(...a);
  }
  putMapping(...a: Parameters<Contract['putMapping']>) {
    return svc(this.env).rpc.putMapping(...a);
  }
  submitBatch(...a: Parameters<Contract['submitBatch']>) {
    return svc(this.env).rpc.submitBatch(...a);
  }
  getImport(...a: Parameters<Contract['getImport']>) {
    return svc(this.env).rpc.getImport(...a);
  }
  listImports(...a: Parameters<Contract['listImports']>) {
    return svc(this.env).rpc.listImports(...a);
  }
  mappingDraft(...a: Parameters<Contract['mappingDraft']>) {
    return svc(this.env).rpc.mappingDraft(...a);
  }
  loadSample(...a: Parameters<Contract['loadSample']>) {
    return svc(this.env).rpc.loadSample(...a);
  }
  usage(...a: Parameters<Contract['usage']>) {
    return svc(this.env).rpc.usage(...a);
  }
}

/** Export / purge / count entry point (bound only by identity-access). */
export class TenantLifecycle extends WorkerEntrypoint<Env> {
  exportTenant(tid: string, cursor: string | null) {
    return svc(this.env).lifecycle!.exportTenant(tid, cursor);
  }
  purgeTenant(tid: string, maxRows: number) {
    return svc(this.env).lifecycle!.purgeTenant(tid, maxRows);
  }
  countTenant(tid: string) {
    return svc(this.env).lifecycle!.countTenant(tid);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
} satisfies ExportedHandler<Env>;
