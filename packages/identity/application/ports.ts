/**
 * @fileoverview Ports of the four identity-access modules. Repositories are
 * grouped by the module that owns the tables (详细设计 6.11.6 表 15):
 * Identity (accounts, codes, sessions, passkeys), Tenancy (workspaces,
 * ledger, archive index, counters), PlatformAdmin (settings, blocklists,
 * audit, pending changes). External services are ports too.
 */

import type {
  AuthMethod,
  LifecycleService,
  Locale,
  TenantLifecycleRpc,
  UserRole,
  WorkspaceStatus,
} from '@ontodecide/shared-kernel';
import type {WorkspaceKind} from '../contract';
import type {
  AnalyticsMetric,
  AuditRow,
  CodePurpose,
  Ledger,
  MailPriority,
  TemplateId,
} from '../domain';

// —— Identity ——

/** A user_account row. */
export interface AccountRecord {
  userId: string;
  tenantId: string;
  role: UserRole;
  emailHmac: string;
  emailEnc: string;
  locale: Locale;
  timeZone: string;
  verifiedAt: number;
  remindedAt: number | null;
  bannedAt: number | null;
}

/** Atomic sign-up command (详细设计 6.11.6 batch). */
export interface SignupCommand {
  day: string;
  ipKey: string;
  userId: string;
  tenantId: string;
  emailHmac: string;
  emailEnc: string;
  locale: Locale;
  now: number;
  trialExpiresAt: number;
  purgeBacklogLimit: number;
}

/** Outcome of the sign-up batch. */
export type SignupOutcome = 'created' | 'closed' | 'duplicate';

/** user_account access. */
export interface AccountRepository {
  findById(userId: string): Promise<AccountRecord | null>;
  findByEmailHmac(emailHmac: string): Promise<AccountRecord | null>;
  findByTenant(tenantId: string): Promise<AccountRecord | null>;
  findAdmin(): Promise<AccountRecord | null>;
  updateProfile(
    userId: string,
    patch: {locale?: Locale; timeZone?: string},
  ): Promise<void>;
  setBanned(userId: string, bannedAt: number | null): Promise<void>;
  replaceEmail(
    userId: string,
    emailHmac: string,
    emailEnc: string,
  ): Promise<void>;
  /** Creates the admin workspace and account; false on a unique conflict. */
  createAdmin(cmd: {
    userId: string;
    tenantId: string;
    emailHmac: string;
    emailEnc: string;
    now: number;
  }): Promise<boolean>;
  /** Admission quota + workspace + owner in one D1 batch. */
  signup(cmd: SignupCommand): Promise<SignupOutcome>;
  /** Owners of ACTIVE trials verified ≥ 48 h ago and not yet reminded. */
  dueReminders(
    verifiedBefore: number,
    now: number,
    limit: number,
  ): Promise<(AccountRecord & {trialExpiresAt: number})[]>;
  /** Conditionally sets reminded_at (true when this call claimed it). */
  claimReminder(userId: string, now: number): Promise<boolean>;
  releaseReminder(userId: string): Promise<void>;
}

/** A pending one-time code. */
export interface PendingCode {
  codeHmac: string;
  attempts: number;
  expiresAt: number;
  emailEnc: string | null;
  locale: Locale | null;
}

/** pending_code and otp_limit access. */
export interface CodeRepository {
  getPending(
    emailHmac: string,
    purpose: CodePurpose,
  ): Promise<PendingCode | null>;
  putPending(
    emailHmac: string,
    purpose: CodePurpose,
    code: Omit<PendingCode, 'attempts'>,
  ): Promise<void>;
  /** Increments attempts and returns the new value. */
  bumpAttempts(emailHmac: string, purpose: CodePurpose): Promise<number>;
  deletePending(emailHmac: string, purpose: CodePurpose): Promise<void>;
  /** Today's sends and the latest lock across days. */
  limits(
    emailHmac: string,
    day: string,
  ): Promise<{sends: number; failures: number; lockedUntil: number | null}>;
  /** Takes one send when sends < max. */
  takeSend(emailHmac: string, day: string, max: number): Promise<boolean>;
  /** Records a failure; returns today's failures after the increment. */
  recordFailure(emailHmac: string, day: string): Promise<number>;
  lock(emailHmac: string, day: string, until: number): Promise<void>;
  sweep(now: number, keepDaysFrom: string): Promise<void>;
}

/** A session row. */
export interface SessionRecord {
  sessionId: string;
  userId: string;
  familyId: string;
  refreshHash: string;
  amr: AuthMethod[];
  client: string | null;
  createdAt: number;
  expiresAt: number;
}

/** session and session_rotated access. */
export interface SessionRepository {
  /** Inserts and evicts the oldest sessions beyond `maxSessions`. */
  create(s: SessionRecord, maxSessions: number): Promise<void>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  findByHash(refreshHash: string): Promise<SessionRecord | null>;
  findRotated(refreshHash: string): Promise<{familyId: string} | null>;
  /** Rotates the refresh hash (conditional on the old one). */
  rotate(
    s: SessionRecord,
    newHash: string,
    newExpiresAt: number,
  ): Promise<boolean>;
  revokeFamily(familyId: string): Promise<number>;
  delete(sessionId: string, userId: string): Promise<void>;
  deleteByUser(userId: string): Promise<number>;
  countActive(userId: string, now: number): Promise<number>;
  /** Whether the user holds an unexpired session signed in by recovery code. */
  hasActiveRecoverySession(userId: string, now: number): Promise<boolean>;
  /** Replaces the authentication methods of one session (recovery upgrade). */
  setAmr(sessionId: string, amr: AuthMethod[]): Promise<void>;
  sweep(now: number): Promise<void>;
}

/** An admin passkey. */
export interface PasskeyRecord {
  credentialId: string;
  userId: string;
  /** base64url COSE public key. */
  publicKey: string;
  signCount: number;
  transports: string[];
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** WebAuthn challenge purposes. */
export type ChallengePurpose = 'register' | 'assert' | 'step_up';

/** admin_passkey, admin_recovery_code, webauthn_challenge, system_flag. */
export interface PasskeyRepository {
  list(userId: string): Promise<PasskeyRecord[]>;
  count(userId: string): Promise<number>;
  find(credentialId: string): Promise<PasskeyRecord | null>;
  insert(p: PasskeyRecord): Promise<void>;
  /** Updates the counter when it is still `expected` (no race). */
  updateCounter(
    credentialId: string,
    expected: number,
    next: number,
    now: number,
  ): Promise<boolean>;
  /** Deletes when more than `keep` passkeys would remain ≥ keep. */
  deleteKeeping(
    credentialId: string,
    userId: string,
    keep: number,
  ): Promise<boolean>;
  deleteAll(userId: string): Promise<void>;
  putChallenge(
    challenge: string,
    userId: string,
    purpose: ChallengePurpose,
    expiresAt: number,
  ): Promise<void>;
  /** Deletes the challenge; true when it existed, matched and was fresh. */
  consumeChallenge(
    challenge: string,
    userId: string,
    purpose: ChallengePurpose,
    now: number,
  ): Promise<boolean>;
  recoveryStats(): Promise<{total: number; unused: number}>;
  replaceRecoveryCodes(hashes: string[]): Promise<void>;
  useRecoveryCode(hash: string, now: number): Promise<boolean>;
  /** Sets a one-shot flag; false when it was already set. */
  setFlagOnce(key: string, now: number): Promise<boolean>;
  hasFlag(key: string): Promise<boolean>;
  clearFlag(key: string): Promise<void>;
  sweepChallenges(now: number): Promise<void>;
}

// —— Tenancy ——

/** A workspace row. */
export interface WorkspaceRecord {
  tenantId: string;
  kind: WorkspaceKind;
  ownerUserId: string;
  status: WorkspaceStatus;
  trialExpiresAt: number | null;
  expiredAt: number | null;
  deleteMode: 'archive' | 'no_archive' | null;
  createdAt: number;
}

/** workspace access (and the account deletion batch). */
export interface WorkspaceRepository {
  get(tenantId: string): Promise<WorkspaceRecord | null>;
  countTrials(statuses: WorkspaceStatus[]): Promise<number>;
  /** ACTIVE → EXPIRED with trial_expires_at = expired_at = now. */
  endTrial(tenantId: string, now: number): Promise<boolean>;
  /** Moves the trial end; re-activates an EXPIRED (not yet archiving) trial. */
  setTrialExpiry(tenantId: string, at: number, now: number): Promise<boolean>;
  setDeleteMode(
    tenantId: string,
    mode: 'archive' | 'no_archive',
  ): Promise<boolean>;
  dueExpirations(now: number, limit: number): Promise<WorkspaceRecord[]>;
  /** Expires one due trial (conditional). */
  expire(tenantId: string, now: number): Promise<boolean>;
  /**
   * An EXPIRED trial past the delay without a ledger, or an ARCHIVING one
   * whose ledger is gone (resumed by the saga).
   */
  nextArchiveCandidate(expiredBefore: number): Promise<WorkspaceRecord | null>;
  markArchiving(tenantId: string): Promise<void>;
  /** Deletes sessions, pending codes, account and workspace; tombstone. */
  deleteAccount(tenantId: string, now: number): Promise<void>;
  sweepTombstones(now: number): Promise<void>;
}

/** purge_ledger access. */
export interface LedgerRepository {
  get(tenantId: string): Promise<Ledger | null>;
  /** The unfinished ledger updated least recently. */
  next(): Promise<Ledger | null>;
  create(l: Ledger): Promise<boolean>;
  /** Applies a patch when updated_at is still `expectedUpdatedAt`. */
  update(
    tenantId: string,
    expectedUpdatedAt: number,
    patch: Partial<Omit<Ledger, 'tenantId' | 'expiredAt'>> & {
      updatedAt: number;
    },
  ): Promise<boolean>;
  delete(tenantId: string): Promise<void>;
  /** Deletes account_deleted ledgers whose archive_index row is gone. */
  deleteOrphans(): Promise<number>;
}

/** An archive_index row. */
export interface ArchiveIndexRecord {
  tenantId: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  deletionTokenHash: string;
  createdAt: number;
  expiresAt: number;
}

/** archive_index access. */
export interface ArchiveIndexRepository {
  /** One row per tenant; a retry overwrites the token and times. */
  upsert(r: ArchiveIndexRecord): Promise<void>;
  get(tenantId: string): Promise<ArchiveIndexRecord | null>;
  findByTokenHash(hash: string): Promise<ArchiveIndexRecord | null>;
  due(now: number, limit: number): Promise<ArchiveIndexRecord[]>;
  list(cursor: string | null, limit: number): Promise<ArchiveIndexRecord[]>;
  count(): Promise<number>;
  /**
   * Deletes archive_index. The purge_ledger row goes too (with the
   * tombstone) only once the saga reached account_deleted; otherwise the
   * saga keeps it and still purges the data and deletes the account.
   */
  finalDelete(tenantId: string, now: number): Promise<void>;
}

/** usage_counter (day, key) access. */
export interface UsageCounter {
  /** Adds n when value + n ≤ cap; true when granted. */
  tryTake(day: string, key: string, n: number, cap: number): Promise<boolean>;
  adjust(day: string, key: string, delta: number): Promise<void>;
  read(day: string, key: string): Promise<number>;
  set(day: string, key: string, value: number): Promise<void>;
  sweep(beforeDay: string): Promise<void>;
}

/** A system_flag row. */
export interface SystemFlag {
  value: number;
  at: number;
}

/**
 * system_flag access for cron bookkeeping (archive step failures, B2
 * signing key first-seen time). Keys and values never hold personal data.
 */
export interface SystemFlagRepository {
  /** Inserts the flag unless it exists; true when this call created it. */
  setOnce(key: string, value: number, at: number): Promise<boolean>;
  get(key: string): Promise<SystemFlag | null>;
  setValue(key: string, value: number): Promise<void>;
  clear(key: string): Promise<void>;
  /** Flags whose key starts with `prefix` and whose `at` ≤ `atOrBefore`. */
  countPrefix(prefix: string, atOrBefore: number): Promise<number>;
}

/** Lifecycle entry points of the five data-owning services. */
export type Lifecycles = Record<LifecycleService, TenantLifecycleRpc>;

// —— PlatformAdmin ——

/** platform_setting values. */
export interface SettingsValues {
  signupEnabled: boolean;
  signupDailyLimit: number;
  activeWorkspaceLimit: number;
  /** max(updated_at). */
  version: number;
}

/** platform_setting, blocked_domain, blocked_email. */
export interface SettingsRepository {
  get(): Promise<SettingsValues>;
  /** Applies a patch when the version still matches (all rows touched). */
  patch(
    patch: Partial<Omit<SettingsValues, 'version'>>,
    ifMatch: number,
    newVersion: number,
  ): Promise<boolean>;
  blockedDomains(): Promise<string[]>;
  anyDomainBlocked(domains: string[]): Promise<boolean>;
  replaceDomains(domains: string[], now: number): Promise<void>;
  isEmailBlocked(emailHmac: string): Promise<boolean>;
  blockEmail(emailHmac: string, now: number): Promise<void>;
  unblockEmail(emailHmac: string): Promise<void>;
}

/** admin_audit access. */
export interface AuditRepository {
  latest(): Promise<AuditRow | null>;
  /** Appends when the chain head is still `prevHash`. */
  append(row: AuditRow): Promise<'ok' | 'stale' | 'duplicate'>;
  findByKey(idempotencyKey: string): Promise<AuditRow | null>;
  /** Newest first, cursor = `${at}:${id}`. */
  page(
    cursor: {at: number; id: string} | null,
    limit: number,
  ): Promise<AuditRow[]>;
  /** Oldest first (chain verification). */
  all(): Promise<AuditRow[]>;
  hasSince(action: string, tenantId: string, since: number): Promise<boolean>;
  sweep(before: number): Promise<void>;
}

/** An admin_pending_change row. */
export interface PendingChange {
  id: string;
  kind: 'email' | 'passkey_reset';
  payload: string | null;
  requestedAt: number;
  effectiveAt: number;
  notifiedAt: number | null;
  appliedAt: number | null;
}

/** admin_pending_change access. */
export interface PendingChangeRepository {
  unnotified(): Promise<PendingChange[]>;
  markNotified(id: string, now: number): Promise<void>;
  dueForApply(now: number): Promise<PendingChange[]>;
  markApplied(id: string, now: number): Promise<boolean>;
}

/** A row of the admin user list (derived ARCHIVE_ONLY rows included). */
export interface AdminListRow {
  tenantId: string;
  userId: string | null;
  emailEnc: string | null;
  status: string;
  trialExpiresAt: number | null;
  zipExpiresAt: number | null;
  sessions: number;
  bannedAt: number | null;
}

/** Cross-table admin queries (read-only). */
export interface AdminQueryRepository {
  listUsers(
    status: string | null,
    cursor: string | null,
    limit: number,
    now: number,
  ): Promise<AdminListRow[]>;
  recentAudit(limit: number): Promise<AuditRow[]>;
}

// —— External services ——

/** Cloudflare Turnstile siteverify. */
export interface TurnstileVerifier {
  verify(token: string, ip: string): Promise<boolean>;
}

/** A message ready to send. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: TemplateId;
  priority: MailPriority;
}

/** Result of a send. */
export interface SendResult {
  ok: boolean;
  status: number;
  /** Channel that accepted (or last refused) the message. */
  channel?: string;
  /** Non-OTP mail refused for lack of quota; the caller retries later. */
  deferred?: boolean;
}

/** One e-mail provider (Resend or the local log sender). */
export interface EmailSender {
  send(msg: EmailMessage, idempotencyKey: string): Promise<SendResult>;
}

/** B2 archive bucket (write key): staging parts, ZIPs, audit anchors. */
export interface BlobStore {
  put(
    key: string,
    body: Uint8Array | string,
    contentType?: string,
  ): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<{size: number} | null>;
  /** Deletes every version of every object under the prefix. */
  deletePrefix(prefix: string): Promise<number>;
  /** Deletes every version of exactly this key. */
  deleteAllVersions(key: string): Promise<number>;
}

/** Local SigV4 presigning with the read-only sign key. */
export interface LinkSigner {
  presignGet(
    key: string,
    ttlSeconds: number,
    disposition: string,
  ): Promise<string>;
}

/** Verified registration. */
export interface VerifiedRegistration {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

/** WebAuthn operations (@simplewebauthn/server behind a port). */
export interface WebAuthnPort {
  registrationOptions(opts: {
    userId: string;
    userName: string;
    exclude: {id: string; transports: string[]}[];
  }): Promise<{options: Record<string, unknown>; challenge: string}>;
  verifyRegistration(
    response: Record<string, unknown>,
    expectedChallenge: string,
  ): Promise<VerifiedRegistration | null>;
  authenticationOptions(opts: {
    allow: {id: string; transports: string[]}[];
  }): Promise<{options: Record<string, unknown>; challenge: string}>;
  /** Null when the assertion does not verify (incl. user verification). */
  verifyAuthentication(
    response: Record<string, unknown>,
    expectedChallenge: string,
    credential: PasskeyRecord,
  ): Promise<{newCounter: number} | null>;
}

/** Cloudflare GraphQL Analytics (account-wide daily totals). */
export interface AnalyticsPort {
  dailyUsage(day: string): Promise<Partial<Record<AnalyticsMetric, number>>>;
}
