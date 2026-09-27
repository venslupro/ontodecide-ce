/**
 * @fileoverview The IdentityRpc handler object (every contract method).
 * Each call first makes sure the bootstrap admin exists (memoized per
 * isolate), then applies the admin session gate (recovery pending /
 * passkey setup incomplete, see PasskeyService.gate) for calls carrying an
 * admin ctx, then delegates to the owning module's application service.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import type {IdentityRpc} from '../contract';
import type {IdentityServices} from './compose';

/** Methods whose first argument is `{ctx}` or `{preAuth}`. */
const AUTH_FIRST = new Set(['passkeyOptions', 'passkeyAssertion']);

/** Methods taking no CallCtx. */
const NO_CTX = new Set([
  'sendCode',
  'createSession',
  'refresh',
  'verifyAdminSession',
  'adminSessionStatus',
  'passkeySetupOptions',
  'passkeySetup',
  'recoveryLogin',
  'workspaceStatus',
  'getArchiveDeletion',
  'deleteArchiveByToken',
]);

/** The CallCtx of a call (undefined for public / pre-auth methods). */
function ctxArg(name: string, args: unknown[]): CallCtx | undefined {
  if (NO_CTX.has(name)) return undefined;
  const first = args[0] as {ctx?: CallCtx} | CallCtx | undefined;
  if (AUTH_FIRST.has(name)) {
    return first && typeof first === 'object' && 'ctx' in first
      ? first.ctx
      : undefined;
  }
  return first as CallCtx | undefined;
}

function adminOnly(ctx: CallCtx): void {
  if (!ctx || ctx.actor?.role !== 'admin') throw new AppError('FORBIDDEN');
}

/** Builds the RPC surface over the wired services. */
export function createIdentityRpc(s: IdentityServices): IdentityRpc {
  const rpc: IdentityRpc = {
    // —— Identity ——
    sendCode: (input, meta) => s.auth.sendCode(input, meta),
    sendMeCode: (ctx, purpose) => s.auth.sendMeCode(ctx, purpose),
    createSession: (input, meta) => s.auth.createSession(input, meta),
    refresh: (token, meta) => s.sessions.refresh(token, meta),
    logout: (ctx, sid) => s.sessions.logout(ctx, sid),
    verifyAdminSession: sid => s.sessions.verifyAdmin(sid),
    adminSessionStatus: sid => s.passkeys.sessionStatus(sid),
    passkeyOptions: (auth, purpose) =>
      s.passkeys.assertionOptions(auth, purpose),
    passkeyAssertion: (auth, purpose, credential, meta) =>
      s.passkeys.assertion(auth, purpose, credential, meta),
    passkeySetupOptions: (preAuth, setupCode) =>
      s.passkeys.setupOptions(preAuth, setupCode),
    passkeySetup: (preAuth, setupCode, credential, meta) =>
      s.passkeys.setup(preAuth, setupCode, credential, meta),
    recoveryLogin: (preAuth, code, meta) =>
      s.passkeys.recoveryLogin(preAuth, code, meta),
    getMe: async ctx => s.accounts.me(await s.accounts.caller(ctx), ctx.sid),
    patchMe: (ctx, patch) => s.accounts.patchMe(ctx, patch),
    usage: ctx => s.accounts.usage(ctx),
    exportChunk: (ctx, cursor) => s.exports.chunk(ctx, cursor),

    // —— Tenancy ——
    terminateTrial: (ctx, code) => s.trials.terminate(ctx, code),
    workspaceStatus: tid => s.workspaces.status(tid),
    getArchiveDeletion: token => s.trials.archiveDeletionInfo(token),
    deleteArchiveByToken: token => s.trials.deleteArchiveByToken(token),

    // —— PlatformAdmin ——
    audit: (ctx, entry) => s.audit.record(ctx, entry),
    adminOverview: ctx => s.admin.overview(ctx),
    adminListUsers: (ctx, q, page) =>
      s.admin.listUsers(ctx, q ?? {}, page ?? {}),
    adminGetUser: (ctx, uid) => s.admin.getUser(ctx, uid),
    adminPatchUser: (ctx, uid, patch, stepUp, key) =>
      s.admin.patchUser(ctx, uid, patch, stepUp, key),
    adminRevokeSessions: (ctx, uid, key) =>
      s.admin.revokeSessions(ctx, uid, key),
    adminDeleteUser: (ctx, uid, opts, stepUp, key) =>
      s.admin.deleteUser(ctx, uid, opts, stepUp, key),
    adminListArchives: (ctx, page) => s.admin.listArchives(ctx, page ?? {}),
    adminArchiveLink: (ctx, tid, key) => s.admin.archiveLink(ctx, tid, key),
    adminDeleteArchive: (ctx, tid, stepUp, key) =>
      s.admin.deleteArchive(ctx, tid, stepUp, key),
    adminGetSettings: ctx => s.admin.getSettings(ctx),
    adminPatchSettings: (ctx, patch, ifMatch, stepUp, key) =>
      s.admin.patchSettings(ctx, patch, ifMatch, stepUp, key),
    adminGetBlockedDomains: ctx => s.admin.getBlockedDomains(ctx),
    adminPutBlockedDomains: (ctx, domains, key) =>
      s.admin.putBlockedDomains(ctx, domains, key),
    adminAuditLog: async (ctx, page) => {
      adminOnly(ctx);
      await s.passkeys.requireAdmin(ctx);
      return s.audit.page(page ?? {});
    },
    adminListPasskeys: ctx => s.passkeys.list(ctx),
    adminPasskeyOptions: ctx => s.passkeys.addOptions(ctx),
    adminAddPasskey: (ctx, credential, label, stepUp) =>
      s.passkeys.add(ctx, credential, label, stepUp),
    adminDeletePasskey: (ctx, id, stepUp) => s.passkeys.remove(ctx, id, stepUp),
  };

  // First request of an isolate: ensure the bootstrap admin exists.
  const wrapped = {} as Record<string, unknown>;
  for (const [name, fn] of Object.entries(rpc)) {
    wrapped[name] = async (...args: unknown[]) => {
      try {
        await s.bootstrap.ensure();
      } catch (e) {
        s.logger.error('identity.bootstrap_failed', {
          code: AppError.from(e).code,
        });
      }
      await s.passkeys.gate(name, ctxArg(name, args));
      return (fn as (...a: unknown[]) => Promise<unknown>)(...args);
    };
  }
  return wrapped as unknown as IdentityRpc;
}
