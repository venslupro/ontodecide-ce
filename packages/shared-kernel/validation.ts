/**
 * @fileoverview Zod parsing that throws VALIDATION_FAILED with field errors.
 */

import type {z} from 'zod';
import {AppError} from './errors';

/** Parses input against a schema; throws VALIDATION_FAILED on mismatch. */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(i => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new AppError(
      'VALIDATION_FAILED',
      errors[0]?.message ?? 'Invalid input',
      {errors},
    );
  }
  return result.data;
}
