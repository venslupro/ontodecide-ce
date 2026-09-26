/**
 * @fileoverview Zod schemas for identity REST inputs.
 */

import {ROLES} from '@ontodecide/shared-kernel';
import {z} from 'zod';

export const loginInputSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

/** 10+ chars with upper, lower and digit. */
export const passwordSchema = z
  .string()
  .min(10)
  .max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a digit');

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const createUserInputSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100),
  role: z.enum(ROLES),
  markings: z.array(z.string().min(1).max(64)).max(50).optional(),
  password: passwordSchema.optional(),
});

export const updateUserInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  disabled: z.boolean().optional(),
});

export const updateMeInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  locale: z.enum(['zh-CN', 'en-US']).optional(),
});

export const grantMarkingInputSchema = z.object({
  markings: z.array(z.string().min(1).max(64)).max(50),
});
