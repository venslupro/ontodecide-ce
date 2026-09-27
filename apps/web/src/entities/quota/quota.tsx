/**
 * @fileoverview Personal quotas (GET /me `quotas`, key `['me']`) and the
 * "我的试用额度" bars used by the cockpit card (前端详细设计 6.11 态势总览).
 * Limits come from the server (never hard-coded); daily counters reset at
 * 00:00 UTC, shown converted to the account time zone.
 */

import type {QuotaKey, Quotas, Used} from '@ontodecide/shared-kernel';
import {useTranslation} from 'react-i18next';
import {fmt} from '../../shared/lib/format';
import {cn} from '../../shared/lib/cn';
import {Progress, usageTone} from '../../shared/ui/progress';
import {useMe} from '../session/api';

/** Quotas of the signed-in user, from GET /me. */
export function useQuotas(): {
  quotas: Quotas | undefined;
  isLoading: boolean;
  timeZone: string | undefined;
} {
  const q = useMe();
  return {
    quotas: q.data?.quotas,
    isLoading: q.isLoading,
    timeZone: q.data?.timeZone,
  };
}

/** Remaining amount of one quota (never negative). */
export function remaining(u: Used | undefined): number {
  return u ? Math.max(0, u.limit - u.used) : 0;
}

/** Whether a quota is used up (limit > 0 and used ≥ limit). */
export function isExhausted(u: Used | undefined): boolean {
  return !!u && u.limit > 0 && u.used >= u.limit;
}

/** Default bars of the cockpit card. */
export const COCKPIT_QUOTA_KEYS: readonly QuotaKey[] = [
  'objects',
  'links',
  'aiRecsToday',
  'importRowsToday',
];

/** Quota bars with "used / limit" and the reset time. */
export function QuotaBars({
  keys = COCKPIT_QUOTA_KEYS,
  className,
  showReset = true,
}: {
  keys?: readonly QuotaKey[];
  className?: string;
  showReset?: boolean;
}) {
  const {t} = useTranslation('common');
  const {quotas, timeZone} = useQuotas();
  if (!quotas) {
    return (
      <p className={cn('text-xs text-dim', className)}>{t('state.loading')}</p>
    );
  }
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {keys.map(key => {
        const u = quotas[key];
        const ratio = u && u.limit > 0 ? u.used / u.limit : 0;
        const tone = usageTone(ratio);
        const label = t(`quota.${key}`);
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted">{label}</span>
              <span className="num text-text">
                {fmt.number(u?.used ?? 0)} / {fmt.number(u?.limit ?? 0)}
                {isExhausted(u) && (
                  <span className="ml-1.5 text-warn">{t('quota.usedUp')}</span>
                )}
              </span>
            </div>
            <Progress
              value={ratio}
              tone={tone === 'good' ? 'accent' : tone}
              label={`${label} ${u?.used ?? 0}/${u?.limit ?? 0}`}
            />
          </div>
        );
      })}
      {showReset && (
        <p className="text-[11px] text-dim">
          {t('quota.resetNote', {
            time: fmt.dateTimeTz(quotas.resetsAt, timeZone),
            tz: fmt.tzName(quotas.resetsAt, timeZone),
          })}
        </p>
      )}
    </div>
  );
}
