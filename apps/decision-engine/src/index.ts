/**
 * @fileoverview decision-engine Worker entry point: the DecisionRpc
 * WorkerEntrypoint plus queue and cron handlers. The only file importing
 * `cloudflare:workers`.
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

/** Service-binding RPC entry point (one explicit method per contract method). */
export class DecisionRpc
  extends WorkerEntrypoint<Env>
  implements DecisionContract
{
  listScenarios(...a: P<'listScenarios'>) {
    return svc(this.env).rpc.listScenarios(...a);
  }
  createScenario(...a: P<'createScenario'>) {
    return svc(this.env).rpc.createScenario(...a);
  }
  getScenario(...a: P<'getScenario'>) {
    return svc(this.env).rpc.getScenario(...a);
  }
  runScenario(...a: P<'runScenario'>) {
    return svc(this.env).rpc.runScenario(...a);
  }
  listCandidateActions(...a: P<'listCandidateActions'>) {
    return svc(this.env).rpc.listCandidateActions(...a);
  }
  generateRecommendation(...a: P<'generateRecommendation'>) {
    return svc(this.env).rpc.generateRecommendation(...a);
  }
  listRecommendations(...a: P<'listRecommendations'>) {
    return svc(this.env).rpc.listRecommendations(...a);
  }
  getRecommendation(...a: P<'getRecommendation'>) {
    return svc(this.env).rpc.getRecommendation(...a);
  }
  approve(...a: P<'approve'>) {
    return svc(this.env).rpc.approve(...a);
  }
  reject(...a: P<'reject'>) {
    return svc(this.env).rpc.reject(...a);
  }
  feedback(...a: P<'feedback'>) {
    return svc(this.env).rpc.feedback(...a);
  }
  suggestMapping(...a: P<'suggestMapping'>) {
    return svc(this.env).rpc.suggestMapping(...a);
  }
  llmQuota(...a: P<'llmQuota'>) {
    return svc(this.env).rpc.llmQuota(...a);
  }
  evaluateOutcomes(...a: P<'evaluateOutcomes'>) {
    return svc(this.env).rpc.evaluateOutcomes(...a);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
  queue: (batch, env) => svc(env).queue!(batch),
  scheduled: (evt, env, ctx) =>
    ctx.waitUntil(svc(env).scheduled!(evt.cron, new Date(evt.scheduledTime))),
} satisfies ExportedHandler<Env>;
