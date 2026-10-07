/**
 * @fileoverview Runtime configuration of identity-access (vars and secrets,
 * docs/ARCHITECTURE.md 2.3), already parsed into numbers.
 */

import type {Ed25519Jwk} from '@ontodecide/shared-kernel';

/** Parsed configuration. */
export interface IdentityConfig {
  environment: string;
  appOrigin: string;
  mailFrom: string;
  emailMode: 'live' | 'log';
  trialHours: number;
  archiveDays: number;
  archiveDelayMin: number;
  purgeBacklogLimit: number;
  purgeRowsDaily: number;
  maxSessions: number;
  adminSessionHours: number;
  resendDailyCap: number;
  resendMonthlyCap: number;
  archiveLinkTtlS: number;
  rpId: string;
  rpName: string;
  signingKey: Ed25519Jwk;
  emailPepper: string;
  emailEncKey: string;
  bootstrapAdminEmail: string | null;
  bootstrapSetupCode: string | null;
  /** B2_SIGN_KEY_ID (rotation check; only its hash is stored). */
  b2SignKeyId?: string | null;
}

/** Admin archive links (POST /admin/archives/{tid}/download-link). */
export const ADMIN_LINK_TTL_S = 900;

/** Reminders, expirations handled per cron tick (subrequest budget). */
export const CRON_BATCH = {reminders: 5, expirations: 10} as const;
