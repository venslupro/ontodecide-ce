/**
 * @fileoverview Worker entry of data-integration: the IntegrationRpc
 * entrypoint (service binding RPC), queue consumer and cron.
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

/** Service-binding RPC surface; one explicit method per contract method. */
export class IntegrationRpc extends WorkerEntrypoint<Env> implements Contract {
  listSources(...a: Parameters<Contract['listSources']>) {
    return svc(this.env).rpc.listSources(...a);
  }
  getSource(...a: Parameters<Contract['getSource']>) {
    return svc(this.env).rpc.getSource(...a);
  }
  createSource(...a: Parameters<Contract['createSource']>) {
    return svc(this.env).rpc.createSource(...a);
  }
  updateSource(...a: Parameters<Contract['updateSource']>) {
    return svc(this.env).rpc.updateSource(...a);
  }
  deleteSource(...a: Parameters<Contract['deleteSource']>) {
    return svc(this.env).rpc.deleteSource(...a);
  }
  presignUpload(...a: Parameters<Contract['presignUpload']>) {
    return svc(this.env).rpc.presignUpload(...a);
  }
  submitBatch(...a: Parameters<Contract['submitBatch']>) {
    return svc(this.env).rpc.submitBatch(...a);
  }
  acceptWebhook(...a: Parameters<Contract['acceptWebhook']>) {
    return svc(this.env).rpc.acceptWebhook(...a);
  }
  listJobs(...a: Parameters<Contract['listJobs']>) {
    return svc(this.env).rpc.listJobs(...a);
  }
  getJob(...a: Parameters<Contract['getJob']>) {
    return svc(this.env).rpc.getJob(...a);
  }
  listRejected(...a: Parameters<Contract['listRejected']>) {
    return svc(this.env).rpc.listRejected(...a);
  }
  replayRejected(...a: Parameters<Contract['replayRejected']>) {
    return svc(this.env).rpc.replayRejected(...a);
  }
  reportWriteResult(...a: Parameters<Contract['reportWriteResult']>) {
    return svc(this.env).rpc.reportWriteResult(...a);
  }
  dataHealth(...a: Parameters<Contract['dataHealth']>) {
    return svc(this.env).rpc.dataHealth(...a);
  }
  pauseSourcesForTypes(...a: Parameters<Contract['pauseSourcesForTypes']>) {
    return svc(this.env).rpc.pauseSourcesForTypes(...a);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
  queue: (batch, env) => svc(env).queue!(batch),
  scheduled: (evt, env, ctx) =>
    ctx.waitUntil(svc(env).scheduled!(evt.cron, new Date(evt.scheduledTime))),
} satisfies ExportedHandler<Env>;
