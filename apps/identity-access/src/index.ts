/**
 * @fileoverview identity-access Worker entry point. Exposes IdentityRpc to
 * api-gateway over a service binding; no public HTTP surface.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {IdentityRpc as Contract} from '@ontodecide/identity/contract';
import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {Env} from './env';
import {createService} from './service';

let cache: {env: Env; svc: ServiceModule<Contract>} | undefined;

function svc(env: Env): ServiceModule<Contract> {
  if (cache?.env !== env) cache = {env, svc: createService(env)};
  return cache.svc;
}

/** Service-binding RPC entry point (one method per contract method). */
export class IdentityRpc extends WorkerEntrypoint<Env> implements Contract {
  login(...a: Parameters<Contract['login']>) {
    return svc(this.env).rpc.login(...a);
  }
  refresh(...a: Parameters<Contract['refresh']>) {
    return svc(this.env).rpc.refresh(...a);
  }
  logout(...a: Parameters<Contract['logout']>) {
    return svc(this.env).rpc.logout(...a);
  }
  me(...a: Parameters<Contract['me']>) {
    return svc(this.env).rpc.me(...a);
  }
  updateMe(...a: Parameters<Contract['updateMe']>) {
    return svc(this.env).rpc.updateMe(...a);
  }
  changePassword(...a: Parameters<Contract['changePassword']>) {
    return svc(this.env).rpc.changePassword(...a);
  }
  listUsers(...a: Parameters<Contract['listUsers']>) {
    return svc(this.env).rpc.listUsers(...a);
  }
  createUser(...a: Parameters<Contract['createUser']>) {
    return svc(this.env).rpc.createUser(...a);
  }
  updateUser(...a: Parameters<Contract['updateUser']>) {
    return svc(this.env).rpc.updateUser(...a);
  }
  grantMarking(...a: Parameters<Contract['grantMarking']>) {
    return svc(this.env).rpc.grantMarking(...a);
  }
  resetPassword(...a: Parameters<Contract['resetPassword']>) {
    return svc(this.env).rpc.resetPassword(...a);
  }
  deleteUser(...a: Parameters<Contract['deleteUser']>) {
    return svc(this.env).rpc.deleteUser(...a);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
} satisfies ExportedHandler<Env>;
