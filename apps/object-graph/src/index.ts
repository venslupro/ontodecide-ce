/**
 * @fileoverview Worker entry point of object-graph: the ObjectGraphRpc
 * WorkerEntrypoint (service binding RPC) plus queue and cron handlers.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {ObjectGraphRpc as Contract} from '@ontodecide/object-graph/contract';
import type {QueueBatch, ServiceModule} from '@ontodecide/shared-kernel';
import type {Env} from './env';
import {createService} from './service';

let cache: {env: Env; svc: ServiceModule<Contract>} | undefined;

function svc(env: Env): ServiceModule<Contract> {
  if (cache?.env !== env) cache = {env, svc: createService(env)};
  return cache.svc;
}

/** RPC entrypoint bound by other Workers as `OBJECTS`. */
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
  evaluateObjectSet(...a: Parameters<Contract['evaluateObjectSet']>) {
    return svc(this.env).rpc.evaluateObjectSet(...a);
  }
  aggregate(...a: Parameters<Contract['aggregate']>) {
    return svc(this.env).rpc.aggregate(...a);
  }
  listObjectSets(...a: Parameters<Contract['listObjectSets']>) {
    return svc(this.env).rpc.listObjectSets(...a);
  }
  saveObjectSet(...a: Parameters<Contract['saveObjectSet']>) {
    return svc(this.env).rpc.saveObjectSet(...a);
  }
  evaluateSavedObjectSet(...a: Parameters<Contract['evaluateSavedObjectSet']>) {
    return svc(this.env).rpc.evaluateSavedObjectSet(...a);
  }
  search(...a: Parameters<Contract['search']>) {
    return svc(this.env).rpc.search(...a);
  }
  lineage(...a: Parameters<Contract['lineage']>) {
    return svc(this.env).rpc.lineage(...a);
  }
  impactSubgraph(...a: Parameters<Contract['impactSubgraph']>) {
    return svc(this.env).rpc.impactSubgraph(...a);
  }
  paths(...a: Parameters<Contract['paths']>) {
    return svc(this.env).rpc.paths(...a);
  }
  applyAction(...a: Parameters<Contract['applyAction']>) {
    return svc(this.env).rpc.applyAction(...a);
  }
  listActionLog(...a: Parameters<Contract['listActionLog']>) {
    return svc(this.env).rpc.listActionLog(...a);
  }
  listMergeSuggestions(...a: Parameters<Contract['listMergeSuggestions']>) {
    return svc(this.env).rpc.listMergeSuggestions(...a);
  }
  resolveMergeSuggestion(...a: Parameters<Contract['resolveMergeSuggestion']>) {
    return svc(this.env).rpc.resolveMergeSuggestion(...a);
  }
  onOntologyPublished(...a: Parameters<Contract['onOntologyPublished']>) {
    return svc(this.env).rpc.onOntologyPublished(...a);
  }
  rebuildProjection(...a: Parameters<Contract['rebuildProjection']>) {
    return svc(this.env).rpc.rebuildProjection(...a);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
  queue: (batch, env) =>
    svc(env).queue!(batch as unknown as QueueBatch<unknown>),
  scheduled: (evt, env, ctx) =>
    ctx.waitUntil(svc(env).scheduled!(evt.cron, new Date(evt.scheduledTime))),
} satisfies ExportedHandler<Env>;
