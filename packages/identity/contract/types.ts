/**
 * @fileoverview Identity & tenancy DTOs (详细设计 6.11.6).
 *
 * Owners sign up and sign in with a 6-digit e-mail code (no passwords) and
 * get one 72-hour trial workspace. The single bootstrap admin signs in with
 * an e-mail code plus a passkey. Times in DTOs are ISO 8601 strings.
 */

import type {
  AuthMethod,
  Locale,
  UserRole,
  Used,
  WorkspaceStatus,
} from '@ontodecide/shared-kernel';

/** Workspace kind. */
export type WorkspaceKind = 'trial' | 'admin';

/** Admin-list status; ARCHIVE_ONLY is derived (account gone, ZIP kept). */
export type AdminUserStatus = WorkspaceStatus | 'ARCHIVE_ONLY';

/** POST /auth/codes body. */
export interface SendCodeInput {
  email: string;
  purpose: 'signup' | 'login';
  turnstileToken: string;
  locale?: Locale;
}

/** POST /auth/sessions body. */
export interface CreateSessionInput {
  email: string;
  code: string;
  purpose: 'signup' | 'login';
}

/** Request metadata forwarded by api-gateway (never stored in clear). */
export interface RequestMeta {
  ip: string;
  /** Short client label derived from the user agent, e.g. "Chrome · macOS". */
  client?: string;
}

/** The caller's workspace. */
export interface WorkspaceDto {
  tenantId: string;
  kind: WorkspaceKind;
  status: WorkspaceStatus;
  verifiedAt: string;
  /** null for the admin workspace. */
  trialExpiresAt: string | null;
  expiredAt: string | null;
}

/** GET /me (identity part; api-gateway adds `quotas`). */
export interface MeDto {
  userId: string;
  email: string;
  role: UserRole;
  locale: Locale;
  timeZone: string;
  workspace: WorkspaceDto;
  sessions: Used;
  /** Admin only. */
  passkeys?: number;
  /** Admin only: recovery codes left. */
  recoveryCodesLeft?: number;
  /** When the current session (refresh token) expires; admin ≤ 8 h. */
  sessionExpiresAt?: string;
  /**
   * Admin only: the session was opened with a recovery code and must bind a
   * new passkey before anything else is allowed.
   */
  recoveryPending?: boolean;
}

/** An issued session. api-gateway turns `refreshToken` into the cookie. */
export interface IssuedSession {
  kind: 'session';
  accessToken: string;
  /** Seconds (900). */
  expiresIn: number;
  refreshToken: string;
  /** Unix ms; cookie expiry. */
  refreshExpiresAt: number;
  amr: AuthMethod[];
  me: MeDto;
}

/** Admin code accepted; a passkey (or recovery code) must follow. */
export interface PasskeyRequired {
  kind: 'passkeyRequired';
  /** Short-lived (5 min) pre-authentication token. */
  preAuth: string;
  /** True until the first passkey is bound with the setup code. */
  setupRequired: boolean;
}

/** Result of POST /auth/sessions and the passkey steps. */
export type SessionResult = IssuedSession | PasskeyRequired;

/** Refreshed access token (the refresh cookie is rotated). */
export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

/** WebAuthn JSON (PublicKeyCredential*OptionsJSON / *ResponseJSON). */
export type WebAuthnJson = Record<string, unknown>;

/** Proof of a fresh passkey user verification (≤ 5 min). */
export interface StepUpToken {
  stepUpToken: string;
  expiresIn: number;
}

/** An admin passkey. */
export interface PasskeyDto {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Passkey registration outcome; recovery codes are shown exactly once. */
export interface PasskeyRegistered {
  passkey: PasskeyDto;
  total: number;
  /** Present once, when the second passkey is bound. */
  recoveryCodes?: string[];
  /** Present for the first (setup) passkey: the admin session. */
  session?: IssuedSession;
}

/**
 * State of an admin session, checked by api-gateway on every admin request.
 * `recoveryPending`: opened with a recovery code and no passkey bound since
 * (only GET /me, the passkey list / options / registration and logout are
 * allowed). `setupIncomplete`: fewer than 2 passkeys or no recovery codes
 * issued yet (only GET /me, passkey registration, step-up and logout).
 */
export interface AdminSessionStatus {
  valid: boolean;
  recoveryPending: boolean;
  setupIncomplete: boolean;
}

/** Status of a workspace for api-gateway (Act-as checks, cached ≤ 60 s). */
export interface WorkspaceStatusDto {
  kind: WorkspaceKind;
  status: WorkspaceStatus;
}

/** Archive "delete now" confirmation data (GET /archive-deletions/{token}). */
export interface ArchiveDeletionInfo {
  expiresAt: string;
  sizeBytes: number;
}

/** A chunk of the GET /me/export JSON Lines stream. */
export interface ExportChunk {
  text: string;
  nextCursor: string | null;
}

/** Free-tier resources shown on the platform overview. */
export type FreeQuotaKey =
  'workers' | 'd1Writes' | 'neurons' | 'queues' | 'emailResend' | 'emailBrevo';

/** GET /admin/overview. */
export interface PlatformOverview {
  activeTrials: Used;
  signupsToday: Used;
  archives: Used;
  purgeBacklog: Used;
  signup: {state: 'open' | 'paused' | 'auto_closed'};
  freeQuota: {key: FreeQuotaKey; used: number; limit: number}[];
  /** When the account-wide analytics were last read. */
  analyticsAt: string | null;
  /**
   * False when CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID are not configured (the
   * hourly free-tier check cannot run; `analyticsAt` stays null).
   */
  analyticsConfigured?: boolean;
  /** Archive sagas whose current step has failed for ≥ 24 h. */
  stuckArchives?: number;
  /** The active B2 signing key is older than ~30 days (rotate it). */
  signKeyRotationDue?: boolean;
  recentActions: {
    at: string;
    action: string;
    target: string | null;
    kind: 'modify' | 'delete' | 'enter' | 'view';
  }[];
}

/** Row of GET /admin/users. */
export interface AdminUserRow {
  userId: string | null;
  tenantId: string;
  /** Full e-mail; null for ARCHIVE_ONLY. */
  email: string | null;
  status: AdminUserStatus;
  trialExpiresAt: string | null;
  zipExpiresAt: string | null;
  sessions: number;
  banned: boolean;
  /** Objects / links held by the workspace (0 once purged). */
  objects: number;
  links: number;
}

/** GET /admin/users/{uid}. */
export interface AdminUserDto extends AdminUserRow {
  locale: Locale;
  timeZone: string;
  verifiedAt: string;
  expiredAt: string | null;
  archivePhase: string | null;
}

/** PATCH /admin/users/{uid} body. */
export interface AdminUserPatch {
  trialExpiresAt?: string;
  status?: 'EXPIRED';
  banned?: boolean;
  reason: string;
}

/** Row of GET /admin/archives. */
export interface ArchiveIndexDto {
  tenantId: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
}

/** Platform settings (CHECK-constrained in D1). */
export interface PlatformSettings {
  signupEnabled: boolean;
  /** 0–20. */
  signupDailyLimit: number;
  /** 0–60 (the admin workspace is not counted). */
  activeWorkspaceLimit: number;
  /** Read-only. */
  trialHours: number;
  archiveDays: number;
  /** Settings version for If-Match. */
  version: number;
}

/** Row of GET /admin/audit-log. */
export interface AdminAuditDto {
  id: string;
  at: string;
  action: string;
  targetTenantId: string | null;
  targetUserId: string | null;
  reason: string | null;
}

/** Business-audit entry the gateway records for Act-as. */
export interface AuditEntry {
  action: 'act_as.enter' | 'tenant.write';
  targetTenantId: string;
  /** operationId of the forwarded request. */
  reason?: string;
}
