/**
 * @fileoverview identity-access Worker entry point. Exposes IdentityRpc to
 * api-gateway over a service binding (no public HTTP surface) and runs the
 * every-2-minutes cron. The only file importing cloudflare:workers.
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
  sendCode(...a: Parameters<Contract['sendCode']>) {
    return svc(this.env).rpc.sendCode(...a);
  }
  sendMeCode(...a: Parameters<Contract['sendMeCode']>) {
    return svc(this.env).rpc.sendMeCode(...a);
  }
  createSession(...a: Parameters<Contract['createSession']>) {
    return svc(this.env).rpc.createSession(...a);
  }
  refresh(...a: Parameters<Contract['refresh']>) {
    return svc(this.env).rpc.refresh(...a);
  }
  logout(...a: Parameters<Contract['logout']>) {
    return svc(this.env).rpc.logout(...a);
  }
  verifyAdminSession(...a: Parameters<Contract['verifyAdminSession']>) {
    return svc(this.env).rpc.verifyAdminSession(...a);
  }
  adminSessionStatus(...a: Parameters<Contract['adminSessionStatus']>) {
    return svc(this.env).rpc.adminSessionStatus(...a);
  }
  passkeyOptions(...a: Parameters<Contract['passkeyOptions']>) {
    return svc(this.env).rpc.passkeyOptions(...a);
  }
  passkeyAssertion(...a: Parameters<Contract['passkeyAssertion']>) {
    return svc(this.env).rpc.passkeyAssertion(...a);
  }
  passkeySetupOptions(...a: Parameters<Contract['passkeySetupOptions']>) {
    return svc(this.env).rpc.passkeySetupOptions(...a);
  }
  passkeySetup(...a: Parameters<Contract['passkeySetup']>) {
    return svc(this.env).rpc.passkeySetup(...a);
  }
  recoveryLogin(...a: Parameters<Contract['recoveryLogin']>) {
    return svc(this.env).rpc.recoveryLogin(...a);
  }
  getMe(...a: Parameters<Contract['getMe']>) {
    return svc(this.env).rpc.getMe(...a);
  }
  patchMe(...a: Parameters<Contract['patchMe']>) {
    return svc(this.env).rpc.patchMe(...a);
  }
  usage(...a: Parameters<Contract['usage']>) {
    return svc(this.env).rpc.usage(...a);
  }
  exportChunk(...a: Parameters<Contract['exportChunk']>) {
    return svc(this.env).rpc.exportChunk(...a);
  }
  terminateTrial(...a: Parameters<Contract['terminateTrial']>) {
    return svc(this.env).rpc.terminateTrial(...a);
  }
  workspaceStatus(...a: Parameters<Contract['workspaceStatus']>) {
    return svc(this.env).rpc.workspaceStatus(...a);
  }
  getArchiveDeletion(...a: Parameters<Contract['getArchiveDeletion']>) {
    return svc(this.env).rpc.getArchiveDeletion(...a);
  }
  deleteArchiveByToken(...a: Parameters<Contract['deleteArchiveByToken']>) {
    return svc(this.env).rpc.deleteArchiveByToken(...a);
  }
  audit(...a: Parameters<Contract['audit']>) {
    return svc(this.env).rpc.audit(...a);
  }
  adminOverview(...a: Parameters<Contract['adminOverview']>) {
    return svc(this.env).rpc.adminOverview(...a);
  }
  adminListUsers(...a: Parameters<Contract['adminListUsers']>) {
    return svc(this.env).rpc.adminListUsers(...a);
  }
  adminGetUser(...a: Parameters<Contract['adminGetUser']>) {
    return svc(this.env).rpc.adminGetUser(...a);
  }
  adminPatchUser(...a: Parameters<Contract['adminPatchUser']>) {
    return svc(this.env).rpc.adminPatchUser(...a);
  }
  adminRevokeSessions(...a: Parameters<Contract['adminRevokeSessions']>) {
    return svc(this.env).rpc.adminRevokeSessions(...a);
  }
  adminDeleteUser(...a: Parameters<Contract['adminDeleteUser']>) {
    return svc(this.env).rpc.adminDeleteUser(...a);
  }
  adminListArchives(...a: Parameters<Contract['adminListArchives']>) {
    return svc(this.env).rpc.adminListArchives(...a);
  }
  adminArchiveLink(...a: Parameters<Contract['adminArchiveLink']>) {
    return svc(this.env).rpc.adminArchiveLink(...a);
  }
  adminDeleteArchive(...a: Parameters<Contract['adminDeleteArchive']>) {
    return svc(this.env).rpc.adminDeleteArchive(...a);
  }
  adminGetSettings(...a: Parameters<Contract['adminGetSettings']>) {
    return svc(this.env).rpc.adminGetSettings(...a);
  }
  adminPatchSettings(...a: Parameters<Contract['adminPatchSettings']>) {
    return svc(this.env).rpc.adminPatchSettings(...a);
  }
  adminGetBlockedDomains(...a: Parameters<Contract['adminGetBlockedDomains']>) {
    return svc(this.env).rpc.adminGetBlockedDomains(...a);
  }
  adminPutBlockedDomains(...a: Parameters<Contract['adminPutBlockedDomains']>) {
    return svc(this.env).rpc.adminPutBlockedDomains(...a);
  }
  adminAuditLog(...a: Parameters<Contract['adminAuditLog']>) {
    return svc(this.env).rpc.adminAuditLog(...a);
  }
  adminListPasskeys(...a: Parameters<Contract['adminListPasskeys']>) {
    return svc(this.env).rpc.adminListPasskeys(...a);
  }
  adminPasskeyOptions(...a: Parameters<Contract['adminPasskeyOptions']>) {
    return svc(this.env).rpc.adminPasskeyOptions(...a);
  }
  adminAddPasskey(...a: Parameters<Contract['adminAddPasskey']>) {
    return svc(this.env).rpc.adminAddPasskey(...a);
  }
  adminDeletePasskey(...a: Parameters<Contract['adminDeletePasskey']>) {
    return svc(this.env).rpc.adminDeletePasskey(...a);
  }
}

export default {
  fetch: () => new Response('Not found', {status: 404}),
  scheduled: (evt, env, ctx) =>
    ctx.waitUntil(svc(env).scheduled!(evt.cron, new Date(evt.scheduledTime))),
} satisfies ExportedHandler<Env>;
