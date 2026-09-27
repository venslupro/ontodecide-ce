/**
 * @fileoverview Bindings, vars and secrets of the identity-access Worker
 * (docs/ARCHITECTURE.md 2.3).
 */

import type {TenantLifecycleRpc} from '@ontodecide/shared-kernel';

/**
 * A service binding to a `TenantLifecycle` entry point. At runtime this is
 * a Workers RPC stub; only the lifecycle methods are called.
 */
export type LifecycleBinding = TenantLifecycleRpc;

/** identity-access environment. */
export interface Env {
  IDENTITY_DB: D1Database;
  LC_ONTOLOGY: LifecycleBinding;
  LC_INTEGRATION: LifecycleBinding;
  LC_OBJECTS: LifecycleBinding;
  LC_SITUATION: LifecycleBinding;
  LC_DECISION: LifecycleBinding;

  // Vars.
  APP_ORIGIN: string;
  MAIL_FROM: string;
  /** `live` (Resend + Brevo) or `log` (local: redacted log line only). */
  EMAIL_MODE?: string;
  TRIAL_HOURS?: string;
  ARCHIVE_DAYS?: string;
  ARCHIVE_DELAY_MIN?: string;
  PURGE_BACKLOG_LIMIT?: string;
  PURGE_ROWS_DAILY?: string;
  MAX_SESSIONS?: string;
  ADMIN_SESSION_HOURS?: string;
  RESEND_DAILY_CAP?: string;
  RESEND_MONTHLY_CAP?: string;
  BREVO_DAILY_CAP?: string;
  B2_ARCHIVE_BUCKET: string;
  B2_ENDPOINT: string;
  B2_REGION: string;
  ARCHIVE_LINK_TTL_S?: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME?: string;
  CF_ACCOUNT_ID?: string;
  ENVIRONMENT?: string;
  APP_VERSION?: string;

  // Secrets.
  /** Ed25519 private JWK with `kid`. */
  JWT_SIGNING_KEY: string;
  EMAIL_PEPPER: string;
  EMAIL_ENC_KEY: string;
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  TURNSTILE_SECRET: string;
  B2_WRITE_KEY_ID: string;
  B2_WRITE_APP_KEY: string;
  B2_SIGN_KEY_ID: string;
  B2_SIGN_APP_KEY: string;
  CF_ANALYTICS_TOKEN?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_SETUP_CODE?: string;
}
