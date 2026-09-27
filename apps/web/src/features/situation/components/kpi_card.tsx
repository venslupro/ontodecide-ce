/**
 * @fileoverview KPI card: value, change vs 24 h ago (▲▼ icon + text, never
 * colour alone), target, mini trend; values off target use the status
 * colour together with a warning icon.
 */

import {resolveText} from '@ontodecide/shared-kernel';
import type {KpiTrend, KpiValue} from '@ontodecide/situation/contract';
import {AlertTriangle, Minus, Triangle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Sparkline} from '../../../shared/charts/sparkline';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {kpiDelta, kpiOffTarget, kpiTrendIsGood} from '../model';

const SERIES = ['var(--cyan)', 'var(--crit)', 'var(--violet)', 'var(--warn)'];

/** KPI card. */
export function KpiCard({
  kpi,
  points,
  index = 0,
}: {
  kpi: KpiValue;
  points?: KpiTrend['points'];
  index?: number;
}) {
  const {t, i18n} = useTranslation('cockpit');
  const name = resolveText(kpi.name, i18n.language, kpi.id);
  const d = kpiDelta(kpi);
  const good = kpiTrendIsGood(kpi);
  const off = kpiOffTarget(kpi);
  const unit = kpi.unit ?? '';
  const pct = unit === '%';
  const deltaText = d
    ? pct
      ? t('kpi.deltaPt', {
          value: fmt.number(Math.abs(d.abs), {maximumFractionDigits: 1}),
        })
      : t('kpi.deltaAbs', {
          value: fmt.number(Math.abs(d.abs), {maximumFractionDigits: 1}),
        })
    : null;
  return (
    <article
      className="glass flex min-w-0 items-end justify-between gap-3 p-4"
      aria-label={name}
    >
      <div className="min-w-0">
        <h3 className="truncate text-xs text-muted">{name}</h3>
        <p
          className={cn(
            'num mt-1 flex items-baseline gap-1 text-[28px] leading-8 font-semibold',
            off ? 'text-crit' : 'text-text',
          )}
        >
          {off && (
            <AlertTriangle
              className="size-4 self-center text-crit"
              aria-label={t('kpi.offTarget')}
            />
          )}
          {fmt.number(kpi.value, {maximumFractionDigits: 1})}
          {unit && (
            <span className="text-sm font-normal text-muted">{unit}</span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
          {d && d.abs !== 0 ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5',
                good ? 'text-good' : 'text-crit',
              )}
            >
              <Triangle
                className={cn('size-3 fill-current', d.abs < 0 && 'rotate-180')}
                aria-hidden
              />
              <span className="sr-only">
                {d.abs > 0 ? t('kpi.up') : t('kpi.down')}
              </span>
              {deltaText}
            </span>
          ) : d ? (
            <span className="inline-flex items-center gap-0.5">
              <Minus className="size-3" aria-hidden />
              {t('kpi.flat')}
            </span>
          ) : null}
          {kpi.target !== null ? (
            <span>
              {t('kpi.target', {value: `${fmt.number(kpi.target)}${unit}`})}
            </span>
          ) : d ? (
            <span>{t('kpi.vsYesterday')}</span>
          ) : null}
        </p>
      </div>
      {points && points.length > 1 && (
        <Sparkline
          values={points.map(p => p.value)}
          color={SERIES[index % SERIES.length]}
          width={120}
          height={36}
        />
      )}
    </article>
  );
}
