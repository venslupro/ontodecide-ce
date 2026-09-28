/**
 * @fileoverview RPC contract of identity-access (IdentityRpc entry point),
 * called only by api-gateway. identity-access binds the TenantLifecycle
 * entry points of the five data-owning services and no business RPC.
 *
 * Internally four modules: Identity, Tenancy, Notification, PlatformAdmin.
 * PlatformAdmin methods require an admin ctx; high-risk ones also take a
 * step-up token from a passkey user verification within the last 5 minutes.
 */

import type {
  CallCtx,
  PageRequest,
  PageResult,
  QuotaItem,
} from '@ontodecide/shared-kernel';
import type {
  AdminAuditDto,
  AdminSessionStatus,
  AdminUserDto,
  AdminUserPatch,
  AdminUserRow,
  ArchiveDeletionInfo,
  ArchiveIndexDto,
  AuditEntry,
  CreateSessionInput,
  ExportChunk,
  IssuedSession,
  MeDto,
  PasskeyDto,
  PasskeyRegistered,
  PlatformOverview,
  PlatformSettings,
  RefreshResult,
  RequestMeta,
  SendCodeInput,
  SessionResult,
  StepUpToken,
  WebAuthnJson,
  WorkspaceStatusDto,
} from './types';

/** identity-access RPC surface. */
export interface IdentityRpc {
  // —— Identity ——
  /**
   * Always resolves (202) whether or not the e-mail exists. SIGNUP_CLOSED
   * when admission fails; RATE_LIMITED when the e-mail's daily sends are
   * used up or it is locked.
   */
  sendCode(input: SendCodeInput, meta: RequestMeta): Promise<void>;
  /** Signed-in owner asks for a `terminate` confirmation code. */
  sendMeCode(ctx: CallCtx, purpose: 'terminate'): Promise<void>;
  /** Owner: session (signup creates user + workspace); admin: passkeyRequired. */
  createSession(
    input: CreateSessionInput,
    meta: RequestMeta,
  ): Promise<SessionResult>;
  /** Rotates the refresh token; replay revokes the family. */
  refresh(refreshToken: string, meta: RequestMeta): Promise<RefreshResult>;
  /** Ends the session of ctx (sid taken from the access token). */
  logout(ctx: CallCtx, sid: string): Promise<void>;
  /** api-gateway checks every admin request (revocation is immediate). */
  verifyAdminSession(sid: string): Promise<boolean>;
  /**
   * Like {@link verifyAdminSession}, plus the recovery / passkey-setup state
   * that restricts what the session may do (api-gateway, every admin call).
   */
  adminSessionStatus(sid: string): Promise<AdminSessionStatus>;
  /** WebAuthn options for admin login (`login`) or a step-up (`step_up`). */
  passkeyOptions(
    auth: {preAuth: string} | {ctx: CallCtx},
    purpose: 'login' | 'step_up',
  ): Promise<WebAuthnJson>;
  /** Login → IssuedSession; step_up → StepUpToken. */
  passkeyAssertion(
    auth: {preAuth: string} | {ctx: CallCtx},
    purpose: 'login' | 'step_up',
    credential: WebAuthnJson,
    meta: RequestMeta,
  ): Promise<IssuedSession | StepUpToken>;
  /** First passkey: requires BOOTSTRAP_ADMIN_SETUP_CODE (then void). */
  passkeySetupOptions(
    preAuth: string,
    setupCode: string,
  ): Promise<WebAuthnJson>;
  passkeySetup(
    preAuth: string,
    setupCode: string,
    credential: WebAuthnJson,
    meta: RequestMeta,
  ): Promise<PasskeyRegistered>;
  /** One-time recovery code instead of a passkey; a new passkey must follow. */
  recoveryLogin(
    preAuth: string,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedSession>;
  getMe(ctx: CallCtx): Promise<MeDto>;
  patchMe(
    ctx: CallCtx,
    patch: {locale?: MeDto['locale']; timeZone?: string},
  ): Promise<MeDto>;
  /** `sessions` quota of the caller. */
  usage(ctx: CallCtx): Promise<QuotaItem[]>;
  /** Next chunk of GET /me/export (JSON Lines of ExportRecord). */
  exportChunk(ctx: CallCtx, cursor: string | null): Promise<ExportChunk>;

  // —— Tenancy ——
  /** Owner only (admin → FORBIDDEN); verifies the terminate code. */
  terminateTrial(ctx: CallCtx, code: string): Promise<void>;
  /** null when the workspace does not exist. */
  workspaceStatus(tid: string): Promise<WorkspaceStatusDto | null>;
  getArchiveDeletion(token: string): Promise<ArchiveDeletionInfo>;
  deleteArchiveByToken(token: string): Promise<void>;

  // —— PlatformAdmin ——
  /** Records act_as.enter (≤ 1 per workspace per hour) or tenant.write. */
  audit(ctx: CallCtx, entry: AuditEntry): Promise<void>;
  adminOverview(ctx: CallCtx): Promise<PlatformOverview>;
  adminListUsers(
    ctx: CallCtx,
    q: {status?: string},
    page: PageRequest,
  ): Promise<PageResult<AdminUserRow>>;
  /** Full e-mail; writes email.view. */
  adminGetUser(ctx: CallCtx, uid: string): Promise<AdminUserDto>;
  /** Changing the trial revokes the user's sessions. Target admin → FORBIDDEN. */
  adminPatchUser(
    ctx: CallCtx,
    uid: string,
    patch: AdminUserPatch,
    stepUp: string,
    idempotencyKey: string,
  ): Promise<AdminUserDto>;
  adminRevokeSessions(
    ctx: CallCtx,
    uid: string,
    idempotencyKey: string,
  ): Promise<{revoked: number}>;
  adminDeleteUser(
    ctx: CallCtx,
    uid: string,
    opts: {archive: boolean; reason: string},
    stepUp: string,
    idempotencyKey: string,
  ): Promise<void>;
  adminListArchives(
    ctx: CallCtx,
    page: PageRequest,
  ): Promise<PageResult<ArchiveIndexDto>>;
  /** 15-minute presigned link; writes archive.download. */
  adminArchiveLink(
    ctx: CallCtx,
    tid: string,
    idempotencyKey: string,
  ): Promise<{url: string; expiresAt: string}>;
  adminDeleteArchive(
    ctx: CallCtx,
    tid: string,
    stepUp: string,
    idempotencyKey: string,
  ): Promise<void>;
  adminGetSettings(ctx: CallCtx): Promise<PlatformSettings>;
  adminPatchSettings(
    ctx: CallCtx,
    patch: Partial<
      Pick<
        PlatformSettings,
        'signupEnabled' | 'signupDailyLimit' | 'activeWorkspaceLimit'
      >
    >,
    ifMatch: number,
    stepUp: string,
    idempotencyKey: string,
  ): Promise<PlatformSettings>;
  adminGetBlockedDomains(ctx: CallCtx): Promise<string[]>;
  adminPutBlockedDomains(
    ctx: CallCtx,
    domains: string[],
    idempotencyKey: string,
  ): Promise<string[]>;
  adminAuditLog(
    ctx: CallCtx,
    page: PageRequest,
  ): Promise<PageResult<AdminAuditDto> & {chainOk: boolean}>;
  adminListPasskeys(ctx: CallCtx): Promise<PasskeyDto[]>;
  adminPasskeyOptions(ctx: CallCtx): Promise<WebAuthnJson>;
  adminAddPasskey(
    ctx: CallCtx,
    credential: WebAuthnJson,
    label: string | undefined,
    stepUp: string,
  ): Promise<PasskeyRegistered>;
  /** CONFLICT when fewer than 2 would remain. */
  adminDeletePasskey(ctx: CallCtx, id: string, stepUp: string): Promise<void>;
}
