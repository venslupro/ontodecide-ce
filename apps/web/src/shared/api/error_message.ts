/**
 * @fileoverview Maps errors to localized messages: Problem `code` → local
 * text (`common:errors.<CODE>`), `detail` only as a supplement.
 */

import type {TFunction} from 'i18next';
import {ApiError} from './errors';

/** Localized message for any thrown value. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const key = `common:errors.${err.code}`;
    const base = t(key, {seconds: err.retryAfter ?? 0, defaultValue: ''});
    if (base) return base;
    return err.detail || t('common:errors.generic');
  }
  if (err instanceof Error && err.message) return err.message;
  return t('common:errors.generic');
}
