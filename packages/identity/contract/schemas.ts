/**
 * @fileoverview Zod schemas for identity REST inputs.
 */

import {z} from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const locale = z.enum(['zh-CN', 'en-US']);
const code = z.string().regex(/^\d{6}$/);
const webauthn = z.record(z.string(), z.unknown());

/** POST /auth/codes body. */
export const sendCodeSchema = z.object({
  email,
  purpose: z.enum(['signup', 'login']),
  turnstileToken: z.string().min(1).max(4096),
  locale: locale.optional(),
});

/** POST /auth/sessions body. */
export const createSessionSchema = z.object({
  email,
  code,
  purpose: z.enum(['signup', 'login']),
});

/** POST /me/codes body. */
export const meCodeSchema = z.object({purpose: z.literal('terminate')});

/** POST /me/trial/termination body. */
export const terminationSchema = z.object({code});

/** PATCH /me body. */
export const patchMeSchema = z
  .object({
    locale: locale.optional(),
    timeZone: z.string().min(1).max(64).optional(),
  })
  .refine(p => p.locale || p.timeZone, 'Nothing to update');

/** POST /auth/passkeys/options body. */
export const passkeyOptionsSchema = z.object({
  purpose: z.enum(['login', 'step_up']),
  preAuth: z.string().optional(),
});

/** POST /auth/passkeys/assertion body. */
export const passkeyAssertionSchema = z.object({
  purpose: z.enum(['login', 'step_up']),
  preAuth: z.string().optional(),
  credential: webauthn,
});

/** POST /auth/passkeys/setup-options body. */
export const passkeySetupOptionsSchema = z.object({
  preAuth: z.string().min(1),
  setupCode: z.string().min(8).max(128),
});

/** POST /auth/passkeys/setup body. */
export const passkeySetupSchema = passkeySetupOptionsSchema.extend({
  credential: webauthn,
});

/** POST /auth/recovery body. */
export const recoverySchema = z.object({
  preAuth: z.string().min(1),
  recoveryCode: z.string().min(8).max(64),
});

/** PATCH /admin/users/{uid} body. */
export const adminUserPatchSchema = z
  .object({
    trialExpiresAt: z.iso.datetime().optional(),
    status: z.literal('EXPIRED').optional(),
    banned: z.boolean().optional(),
    reason: z.string().min(1).max(500),
  })
  .refine(
    p => p.trialExpiresAt || p.status || p.banned !== undefined,
    'Nothing to update',
  );

/** DELETE /admin/users/{uid} body (archive flag comes from the query). */
export const adminDeleteUserSchema = z.object({
  reason: z.string().min(1).max(500),
});

/** PATCH /admin/settings body. */
export const adminSettingsPatchSchema = z
  .object({
    signupEnabled: z.boolean().optional(),
    signupDailyLimit: z.number().int().min(0).max(20).optional(),
    activeWorkspaceLimit: z.number().int().min(0).max(60).optional(),
  })
  .refine(p => Object.keys(p).length > 0, 'Nothing to update');

/** PUT /admin/blocked-domains body. */
export const blockedDomainsSchema = z.object({
  domains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
    )
    .max(5000),
});

/** POST /admin/passkeys body. */
export const addPasskeySchema = z.object({
  credential: webauthn,
  label: z.string().max(60).optional(),
});
