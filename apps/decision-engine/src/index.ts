/**
 * @fileoverview decision-engine Worker entry point: the DecisionRpc and
 * TenantLifecycle WorkerEntrypoints. The only file importing
 * `cloudflare:workers`. No routes, no queue, no cron.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {DecisionRpc as DecisionContract} from '@ontodecide/decision/contract';
import type {Env} from './env';
import {createService} from './service';

let cache: {env: Env; svc: ServiceModule<DecisionContract>} | undefined;

function svc(env: Env): ServiceModule<DecisionContract> {
  if (cache?.env !== env) cache = {env, svc: createService(env)};
  return cache.svc;
}

type P<K extends keyof DecisionContract> = Parameters<DecisionContract[K]>;

/** Business RPC entry point (bound by api-gateway). */
export class DecisionRpc
  extends WorkerEntrypoint<Env>
  implements DecisionContract
{
  runScenario(...a: P<'runScenario'>) {
    return svc(this.env).rpc.runScenario(...a);
  }
  getScenario(...a: P<'getScenario'>) {
    return svc(this.env).rpc.getScenario(...a);
  }
  listRecommendations(...a: P<'listRecommendations'>) {
    return svc(this.env).rpc.listRecommendations(...a);
  }
  getRecommendation(...a: P<'getRecommendation'>) {
    return svc(this.env).rpc.getRecommendation(...a);
  }
  generateRecommendation(...a: P<'generateRecommendation'>) {
    return svc(this.env).rpc.generateRecommendation(...a);
  }
  decide(...a: P<'decide'>) {
    return svc(this.env).rpc.decide(...a);
  }
  usage(...a: P<'usage'>) {
    return svc(this.env).rpc.usage(...a);
  }
}

/** Lifecycle entry point (bound only by identity-access). */
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
