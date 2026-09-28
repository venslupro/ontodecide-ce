/**
 * @fileoverview Wires the four identity-access modules (Identity, Tenancy,
 * Notification, PlatformAdmin) from a D1 database, configuration and the
 * external adapters. Used by apps/identity-access/src/container.ts and by
 * tests.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import {
  AccountService,
  AdminService,
  AdmissionService,
  ArchiveSagaService,
  AuditService,
  AuthService,
  BootstrapAdmin,
  ExportService,
  HousekeepingService,
  MaintenanceService,
  NotificationService,
  OtpService,
  PasskeyService,
  PolicyService,
  RoutedEmailSender,
  Secrets,
  SessionService,
  TokenService,
  TrialService,
  WorkspaceDirectory,
  type AnalyticsPort,
  type BlobStore,
  type EmailSender,
  type IdentityConfig,
  type Lifecycles,
  type LinkSigner,
  type TurnstileVerifier,
  type WebAuthnPort,
} from '../application';
import {
  D1AccountRepository,
  D1AdminQueryRepository,
  D1ArchiveIndexRepository,
  D1AuditRepository,
  D1CodeRepository,
  D1LedgerRepository,
  D1PasskeyRepository,
  D1PendingChangeRepository,
  D1SessionRepository,
  D1SettingsRepository,
  D1SystemFlagRepository,
  D1UsageCounter,
  D1WorkspaceRepository,
} from '../infrastructure';

/** Mail delivery: providers (routed and counted) or the local log sender. */
export type MailSetup =
  | {mode: 'log'; sender: EmailSender}
  | {mode: 'live'; resend: EmailSender | null; brevo: EmailSender | null};

/** Everything the modules need. */
export interface IdentityOptions {
  db: D1Database;
  config: IdentityConfig;
  clock: Clock;
  logger: Logger;
  lifecycles: Lifecycles;
  blobs: BlobStore;
  signer: LinkSigner;
  webauthn: WebAuthnPort;
  turnstile: TurnstileVerifier;
  mail: MailSetup;
  analytics: AnalyticsPort | null;
}

/** The wired application services. */
export interface IdentityServices {
  config: IdentityConfig;
  clock: Clock;
  logger: Logger;
  bootstrap: BootstrapAdmin;
  accounts: AccountService;
  auth: AuthService;
  sessions: SessionService;
  passkeys: PasskeyService;
  exports: ExportService;
  workspaces: WorkspaceDirectory;
  trials: TrialService;
  saga: ArchiveSagaService;
  audit: AuditService;
  admin: AdminService;
  maintenance: MaintenanceService;
  housekeeping: HousekeepingService;
  notification: NotificationService;
}

/** Builds the module graph. */
export function composeIdentity(o: IdentityOptions): IdentityServices {
  const {db, config: cfg, clock, logger} = o;
  // Repositories, grouped by owning module.
  const accountRepo = new D1AccountRepository(db);
  const codeRepo = new D1CodeRepository(db);
  const sessionRepo = new D1SessionRepository(db);
  const passkeyRepo = new D1PasskeyRepository(db);
  const workspaceRepo = new D1WorkspaceRepository(db);
  const ledgerRepo = new D1LedgerRepository(db);
  const archiveRepo = new D1ArchiveIndexRepository(db);
  const usage = new D1UsageCounter(db);
  const settingsRepo = new D1SettingsRepository(db);
  const auditRepo = new D1AuditRepository(db);
  const pendingRepo = new D1PendingChangeRepository(db);
  const queryRepo = new D1AdminQueryRepository(db);
  const flagRepo = new D1SystemFlagRepository(db);
  // The audit chain is written by Identity (passkeys, sign-ins) too.
  const audit = new AuditService(auditRepo, clock);

  const secrets = new Secrets(cfg.emailPepper, cfg.emailEncKey);
  const tokens = new TokenService(cfg.signingKey, clock);

  // Notification.
  const sender: EmailSender =
    o.mail.mode === 'log'
      ? o.mail.sender
      : new RoutedEmailSender(
          [
            ...(o.mail.resend
              ? [
                  {
                    caps: {
                      name: 'resend' as const,
                      dailyCap: cfg.resendDailyCap,
                      monthlyCap: cfg.resendMonthlyCap,
                    },
                    sender: o.mail.resend,
                  },
                ]
              : []),
            ...(o.mail.brevo
              ? [
                  {
                    caps: {name: 'brevo' as const, dailyCap: cfg.brevoDailyCap},
                    sender: o.mail.brevo,
                  },
                ]
              : []),
          ],
          usage,
          clock,
        );
  const notification = new NotificationService(sender);

  // PlatformAdmin policy (read by the other modules).
  const policy = new PolicyService(settingsRepo);

  // Tenancy read model.
  const workspaces = new WorkspaceDirectory(workspaceRepo);
  const admission = new AdmissionService(
    workspaceRepo,
    usage,
    policy,
    clock,
    cfg.purgeBacklogLimit,
  );

  // Identity.
  const accounts = new AccountService(
    accountRepo,
    sessionRepo,
    passkeyRepo,
    workspaces,
    secrets,
    clock,
    cfg.maxSessions,
  );
  const otp = new OtpService(codeRepo, secrets, notification, clock);
  const sessions = new SessionService(
    sessionRepo,
    accounts,
    workspaces,
    tokens,
    clock,
    {
      trialHours: cfg.trialHours,
      adminSessionHours: cfg.adminSessionHours,
      maxSessions: cfg.maxSessions,
    },
  );
  const auth = new AuthService({
    accounts,
    otp,
    sessions,
    passkeys: passkeyRepo,
    workspaces,
    admission,
    policy,
    turnstile: o.turnstile,
    secrets,
    tokens,
    clock,
    logger,
    trialHours: cfg.trialHours,
    purgeBacklogLimit: cfg.purgeBacklogLimit,
  });
  const passkeys = new PasskeyService({
    passkeys: passkeyRepo,
    webauthn: o.webauthn,
    accounts,
    sessions,
    workspaces,
    notification,
    tokens,
    secrets,
    audit,
    clock,
    logger,
    setupCode: cfg.bootstrapSetupCode,
  });
  const bootstrap = new BootstrapAdmin(
    accountRepo,
    secrets,
    clock,
    logger,
    cfg.bootstrapAdminEmail,
  );
  const exports = new ExportService(o.lifecycles);

  // Tenancy.
  const trials = new TrialService({
    workspaces: workspaceRepo,
    archives: archiveRepo,
    ledgers: ledgerRepo,
    blobs: o.blobs,
    lifecycles: o.lifecycles,
    accounts,
    sessions,
    otp,
    notification,
    clock,
    logger,
    appOrigin: cfg.appOrigin,
  });
  const saga = new ArchiveSagaService({
    ledgers: ledgerRepo,
    workspaces: workspaceRepo,
    archives: archiveRepo,
    blobs: o.blobs,
    signer: o.signer,
    lifecycles: o.lifecycles,
    usage,
    flags: flagRepo,
    accounts,
    notification,
    clock,
    logger,
    appOrigin: cfg.appOrigin,
    archiveDelayMin: cfg.archiveDelayMin,
    archiveDays: cfg.archiveDays,
    archiveLinkTtlS: cfg.archiveLinkTtlS,
    purgeRowsDaily: cfg.purgeRowsDaily,
  });

  // PlatformAdmin.
  const admin = new AdminService({
    passkeys,
    audit,
    accounts,
    sessions,
    trials,
    workspaces: workspaceRepo,
    ledgers: ledgerRepo,
    archives: archiveRepo,
    queries: queryRepo,
    settings: settingsRepo,
    usage,
    flags: flagRepo,
    lifecycles: o.lifecycles,
    signer: o.signer,
    secrets,
    clock,
    analyticsConfigured: o.analytics !== null,
    signKeyId: cfg.b2SignKeyId ?? null,
    purgeBacklogLimit: cfg.purgeBacklogLimit,
    trialHours: cfg.trialHours,
    archiveDays: cfg.archiveDays,
    resendDailyCap: cfg.resendDailyCap,
    brevoDailyCap: cfg.brevoDailyCap,
  });
  const maintenance = new MaintenanceService({
    pending: pendingRepo,
    accounts,
    passkeys: passkeyRepo,
    sessions,
    notification,
    audit,
    usage,
    flags: flagRepo,
    blobs: o.blobs,
    analytics: o.analytics,
    signKeyId: cfg.b2SignKeyId ?? null,
    secrets,
    clock,
    logger,
  });
  const housekeeping = new HousekeepingService(
    codeRepo,
    sessionRepo,
    passkeyRepo,
    workspaceRepo,
    auditRepo,
    usage,
    clock,
  );

  return {
    config: cfg,
    clock,
    logger,
    bootstrap,
    accounts,
    auth,
    sessions,
    passkeys,
    exports,
    workspaces,
    trials,
    saga,
    audit,
    admin,
    maintenance,
    housekeeping,
    notification,
  };
}
