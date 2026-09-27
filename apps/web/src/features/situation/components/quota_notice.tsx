/**
 * @fileoverview Inline quota feedback (前端详细设计 表 10): a 429
 * QUOTA_EXCEEDED is shown next to the action that hit it — never as a
 * global error — with the UTC-midnight reset converted to the account time
 * zone. Also a small "remaining n/limit" hint for scarce actions.
 */

import {nextUtcMidnight, type QuotaKey} from '@ontodecide/shared-kernel';
import {Clock} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useQuotas} from '../../../entities/quota';
import {isApiError} from '../../../shared/api/errors';
import {cn} from '../../../shared/lib/cn';

/** Formats a reset instant in the account time zone with the zone name. */
export function formatResetTime(
  iso: string,
  locale: string,
  timeZone?: string,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat(locale, {...opts, timeZone}).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(iso));
  }
}

/** Reset instant of a quota error (Problem `resetsAt`, else next UTC 0:00). */
export function quotaResetAt(err: unknown, fallback?: string): string {
  if (isApiError(err) && typeof err.extras.resetsAt === 'string')
    return err.extras.resetsAt;
  return fallback ?? nextUtcMidnight(new Date());
}

/** One personal quota (from `GET /me`) with its reset instant. */
export function useMyQuota(key: QuotaKey) {
  const {quotas, timeZone} = useQuotas();
  return {used: quotas?.[key], resetsAt: quotas?.resetsAt, timeZone};
}

/**
 * Renders the inline QUOTA_EXCEEDED message for `error`, or nothing when
 * the error is something else.
 */
export function QuotaNotice({
  error,
  quota,
  className,
}: {
  error: unknown;
  quota: QuotaKey;
  className?: string;
}) {
  const {t, i18n} = useTranslation('cockpit');
  const {used, resetsAt, timeZone: tz} = useMyQuota(quota);
  if (!isApiError(error, 'QUOTA_EXCEEDED')) return null;
  const at = formatResetTime(quotaResetAt(error, resetsAt), i18n.language, tz);
  return (
    <p
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-warn',
        className,
      )}
    >
      <Clock className="size-3.5 shrink-0" aria-hidden />
      {t('quota.exceeded', {
        what: t(`quota.keys.${quota}`),
        used: used?.used ?? used?.limit ?? 0,
        limit: used?.limit ?? 0,
        at,
      })}
    </p>
  );
}

/** "Today: n / limit left" hint for a scarce action. */
export function QuotaRemaining({
  quota,
  className,
}: {
  quota: QuotaKey;
  className?: string;
}) {
  const {t} = useTranslation('cockpit');
  const {used} = useMyQuota(quota);
  if (!used || !used.limit) return null;
  const left = Math.max(0, used.limit - used.used);
  return (
    <span className={cn('text-xs text-muted tabular-nums', className)}>
      {t('quota.remaining', {left, limit: used.limit})}
    </span>
  );
}
