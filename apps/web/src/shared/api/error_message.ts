/**
 * @fileoverview Maps errors to localized messages (前端详细设计 6.6): the
 * Problem `code` selects `common:errors.<CODE>`; ICU arguments come from
 * the Problem extensions (`left`, `what`, `resetAt`) and Retry-After
 * (`seconds`). `detail` is only a fallback supplement.
 */

import type {TFunction} from 'i18next';
import {ApiError} from './errors';
import {DEFAULT_RETRY_AFTER_S} from './rate_limit';

/** Localized message for any thrown value. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const x = err.extras;
    const base = t(`common:errors.${err.code}`, {
      seconds: Math.max(1, err.retryAfter ?? DEFAULT_RETRY_AFTER_S),
      left: typeof x.left === 'number' ? x.left : 0,
      what: typeof x.what === 'string' ? x.what : '',
      resetAt: typeof x.resetAt === 'string' ? x.resetAt : '',
      defaultValue: '',
    });
    if (base) return base;
    return err.detail || t('common:errors.generic');
  }
  if (err instanceof Error && err.message) return err.message;
  return t('common:errors.generic');
}

/** The traceId of an API error, for "details" (support reference). */
export function errorTraceId(err: unknown): string | undefined {
  return err instanceof ApiError ? err.traceId : undefined;
}
