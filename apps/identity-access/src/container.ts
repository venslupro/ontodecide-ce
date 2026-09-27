/**
 * @fileoverview Composition root of identity-access: parses the environment
 * and binds the modules to D1, B2, Resend / Brevo, Turnstile, WebAuthn and
 * the five TenantLifecycle bindings. Tests override adapters.
 */

import type {IdentityRpc} from '@ontodecide/identity/contract';
import type {
  AnalyticsPort,
  BlobStore,
  IdentityConfig,
  LinkSigner,
  TurnstileVerifier,
  WebAuthnPort,
} from '@ontodecide/identity/application';
import {
  B2BlobStore,
  B2LinkSigner,
  BrevoSender,
  CloudflareAnalytics,
  FakeLinkSigner,
  HttpTurnstileVerifier,
  InMemoryBlobStore,
  LogEmailSender,
  ResendSender,
  SimpleWebAuthn,
} from '@ontodecide/identity/infrastructure';
import {
  composeIdentity,
  createIdentityRpc,
  runCron,
  type IdentityServices,
  type MailSetup,
} from '@ontodecide/identity/interface';
import {
  LIFECYCLE,
  createLogger,
  parseSigningKey,
  systemClock,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import type {Env} from './env';

/** Test and environment overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** Outbound fetch (Turnstile, Resend, Brevo, B2, Analytics). */
  fetch?: typeof fetch;
  blobs?: BlobStore;
  signer?: LinkSigner;
  webauthn?: WebAuthnPort;
  turnstile?: TurnstileVerifier;
  /** Replaces the provider list (e.g. fake senders). */
  mail?: MailSetup;
  analytics?: AnalyticsPort | null;
}

/** Wired identity-access objects. */
export interface Container {
  services: IdentityServices;
  rpc: IdentityRpc;
  cron(cron: string, now: Date): Promise<void>;
}

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

/** Parses vars and secrets into the module configuration. */
export function parseConfig(env: Env): IdentityConfig {
  const origin = (env.APP_ORIGIN ?? '').replace(/\/+$/, '');
  return {
    environment: env.ENVIRONMENT ?? 'local',
    appOrigin: origin,
    mailFrom: env.MAIL_FROM,
    emailMode: env.EMAIL_MODE === 'log' ? 'log' : 'live',
    trialHours: int(env.TRIAL_HOURS, LIFECYCLE.trialHours),
    archiveDays: int(env.ARCHIVE_DAYS, LIFECYCLE.archiveDays),
    archiveDelayMin: int(env.ARCHIVE_DELAY_MIN, LIFECYCLE.archiveDelayMin),
    purgeBacklogLimit: int(env.PURGE_BACKLOG_LIMIT, 10),
    purgeRowsDaily: int(env.PURGE_ROWS_DAILY, 30_000),
    maxSessions: int(env.MAX_SESSIONS, 3),
    adminSessionHours: int(
      env.ADMIN_SESSION_HOURS,
      LIFECYCLE.adminSessionHours,
    ),
    resendDailyCap: int(env.RESEND_DAILY_CAP, 90),
    resendMonthlyCap: int(env.RESEND_MONTHLY_CAP, 2900),
    brevoDailyCap: int(env.BREVO_DAILY_CAP, 280),
    archiveLinkTtlS: int(env.ARCHIVE_LINK_TTL_S, 604_800),
    rpId: env.WEBAUTHN_RP_ID,
    rpName: env.WEBAUTHN_RP_NAME ?? 'OntoDecide CE',
    signingKey: parseSigningKey(env.JWT_SIGNING_KEY),
    emailPepper: env.EMAIL_PEPPER,
    emailEncKey: env.EMAIL_ENC_KEY,
    bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL?.trim() || null,
    bootstrapSetupCode: env.BOOTSTRAP_ADMIN_SETUP_CODE?.trim() || null,
  };
}

function mailSetup(
  env: Env,
  cfg: IdentityConfig,
  logger: Logger,
  f: typeof fetch,
): MailSetup {
  if (cfg.emailMode === 'log') {
    return {
      mode: 'log',
      sender: new LogEmailSender(logger, cfg.environment !== 'prd'),
    };
  }
  return {
    mode: 'live',
    resend: env.RESEND_API_KEY
      ? new ResendSender(env.RESEND_API_KEY, cfg.mailFrom, f)
      : null,
    brevo: env.BREVO_API_KEY
      ? new BrevoSender(env.BREVO_API_KEY, cfg.mailFrom, f)
      : null,
  };
}

/** Builds the container from bindings. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger =
    overrides.logger ??
    createLogger({service: 'identity-access', env: env.ENVIRONMENT});
  const f = overrides.fetch ?? ((input, init) => fetch(input, init));
  const cfg = parseConfig(env);
  const b2 = {
    endpoint: env.B2_ENDPOINT,
    bucket: env.B2_ARCHIVE_BUCKET,
    region: env.B2_REGION,
  };
  // `wrangler dev` without B2 keys keeps archives in isolate memory.
  const localWithoutB2 = env.ENVIRONMENT === 'local' && !env.B2_WRITE_KEY_ID;
  const services = composeIdentity({
    db: env.IDENTITY_DB,
    config: cfg,
    clock,
    logger,
    lifecycles: {
      ontology: env.LC_ONTOLOGY,
      integration: env.LC_INTEGRATION,
      objects: env.LC_OBJECTS,
      situation: env.LC_SITUATION,
      decision: env.LC_DECISION,
    },
    blobs:
      overrides.blobs ??
      (localWithoutB2
        ? new InMemoryBlobStore()
        : new B2BlobStore(
            {keyId: env.B2_WRITE_KEY_ID, appKey: env.B2_WRITE_APP_KEY},
            b2,
            f,
          )),
    signer:
      overrides.signer ??
      (localWithoutB2
        ? new FakeLinkSigner()
        : new B2LinkSigner(
            {keyId: env.B2_SIGN_KEY_ID, appKey: env.B2_SIGN_APP_KEY},
            b2,
          )),
    webauthn:
      overrides.webauthn ??
      new SimpleWebAuthn({
        rpId: cfg.rpId,
        rpName: cfg.rpName,
        origin: cfg.appOrigin,
      }),
    turnstile:
      overrides.turnstile ?? new HttpTurnstileVerifier(env.TURNSTILE_SECRET, f),
    mail: overrides.mail ?? mailSetup(env, cfg, logger, f),
    analytics:
      overrides.analytics !== undefined
        ? overrides.analytics
        : env.CF_ANALYTICS_TOKEN && env.CF_ACCOUNT_ID
          ? new CloudflareAnalytics(
              env.CF_ACCOUNT_ID,
              env.CF_ANALYTICS_TOKEN,
              f,
            )
          : null,
  });
  return {
    services,
    rpc: createIdentityRpc(services),
    cron: async (_cron, now) => {
      const r = await runCron(services, now);
      logger.info('identity.cron', {
        archive: r.archive,
        expired: r.expired,
        reminders: r.reminders,
        finalDeleted: r.finalDeleted,
        errors: r.errors,
      });
    },
  };
}
