/**
 * @fileoverview ontology-manager Worker entry point. The only file that
 * imports `cloudflare:workers`.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {OntologyRpc as Contract} from '@ontodecide/ontology/contract';
import type {Env} from './env';
import {createService} from './service';

let cache: {env: Env; svc: ServiceModule<Contract>} | undefined;
const svc = (env: Env): ServiceModule<Contract> =>
  cache?.env === env ? cache.svc : (cache = {env, svc: createService(env)}).svc;

/** Service-binding RPC entrypoint (`entrypoint: "OntologyRpc"`). */
export class OntologyRpc extends WorkerEntrypoint<Env> implements Contract {
  listSchemas(...a: Parameters<Contract['listSchemas']>) {
    return svc(this.env).rpc.listSchemas(...a);
  }
  getSchema(...a: Parameters<Contract['getSchema']>) {
    return svc(this.env).rpc.getSchema(...a);
  }
  getCompiledSchema(...a: Parameters<Contract['getCompiledSchema']>) {
    return svc(this.env).rpc.getCompiledSchema(...a);
  }
  getActiveModel(...a: Parameters<Contract['getActiveModel']>) {
    return svc(this.env).rpc.getActiveModel(...a);
  }
  saveDraft(...a: Parameters<Contract['saveDraft']>) {
    return svc(this.env).rpc.saveDraft(...a);
  }
  diff(...a: Parameters<Contract['diff']>) {
    return svc(this.env).rpc.diff(...a);
  }
  publish(...a: Parameters<Contract['publish']>) {
    return svc(this.env).rpc.publish(...a);
  }
  listPacks(...a: Parameters<Contract['listPacks']>) {
    return svc(this.env).rpc.listPacks(...a);
  }
  getPack(...a: Parameters<Contract['getPack']>) {
    return svc(this.env).rpc.getPack(...a);
  }
  importPack(...a: Parameters<Contract['importPack']>) {
    return svc(this.env).rpc.importPack(...a);
  }
  exportPack(...a: Parameters<Contract['exportPack']>) {
    return svc(this.env).rpc.exportPack(...a);
  }
  evaluateFunction(...a: Parameters<Contract['evaluateFunction']>) {
    return svc(this.env).rpc.evaluateFunction(...a);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
} satisfies ExportedHandler<Env>;
