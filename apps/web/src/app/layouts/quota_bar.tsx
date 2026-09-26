/**
 * @fileoverview Free-tier quota indicator: the highest resource ratio drives
 * the color (≥ 80% yellow, ≥ 95% red); the popover lists every resource.
 */

import {USAGE_RESOURCES, type UsageResource} from '@ontodecide/shared-kernel';
import {Gauge} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {useUsage} from '../../features/situation/api';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {Popover, PopoverContent, PopoverTrigger} from '../../shared/ui/popover';
import {Progress, usageTone} from '../../shared/ui/progress';

/** Highest usage ratio and its resource. */
export function maxUsage(
  ratios: Partial<Record<UsageResource, number>> | undefined,
): {resource?: UsageResource; ratio: number} {
  let best: {resource?: UsageResource; ratio: number} = {ratio: 0};
  for (const r of USAGE_RESOURCES) {
    const v = ratios?.[r] ?? 0;
    if (v > best.ratio) best = {resource: r, ratio: v};
  }
  return best;
}

/** Quota bar in the top bar. */
export function QuotaBar() {
  const {t} = useTranslation('common');
  useUsage();
  const usage = useSession(s => s.usage);
  const {ratio} = maxUsage(usage?.ratios);
  const tone = usageTone(ratio);
  const label = t('quota.label', {pct: fmt.percent(ratio)});
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-9 items-center gap-2 rounded-[8px] px-2 text-xs text-muted hover:bg-panel-2"
        >
          <Gauge
            className={cn(
              'size-4',
              tone === 'crit'
                ? 'text-crit'
                : tone === 'warn'
                  ? 'text-warn'
                  : 'text-good',
            )}
            aria-hidden
          />
          <span className="hidden w-16 lg:block">
            <Progress value={ratio} tone={tone} />
          </span>
          <span
            className={cn(
              'num',
              tone === 'crit'
                ? 'text-crit'
                : tone === 'warn'
                  ? 'text-warn'
                  : 'text-muted',
            )}
          >
            {fmt.percent(ratio)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-xs font-semibold text-muted">
          {t('quota.title')}
        </p>
        <ul className="space-y-2">
          {USAGE_RESOURCES.map(r => {
            const v = usage?.ratios?.[r] ?? 0;
            const tn = usageTone(v);
            return (
              <li key={r}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted">
                    {t(`quota.resources.${r.replace('.', '_')}`)}
                  </span>
                  <span
                    className={cn(
                      'num',
                      tn === 'crit'
                        ? 'text-crit'
                        : tn === 'warn'
                          ? 'text-warn'
                          : 'text-text',
                    )}
                  >
                    {fmt.percent(v)}
                    {tn !== 'good' && (
                      <span className="ml-1">
                        {tn === 'crit'
                          ? t('quota.critical')
                          : t('quota.warning')}
                      </span>
                    )}
                  </span>
                </div>
                <Progress
                  value={v}
                  tone={tn}
                  marker={0.8}
                  label={t(`quota.resources.${r.replace('.', '_')}`)}
                />
              </li>
            );
          })}
        </ul>
        {tone === 'crit' && (
          <p className="mt-3 text-xs text-crit">{t('quota.writePaused')}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
