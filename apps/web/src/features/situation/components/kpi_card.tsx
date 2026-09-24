/**
 * @fileoverview KPI card: name, big value with unit (fades in on change),
 * change vs yesterday (▲▼ glyph + text, colored by whether the change is
 * good for this KPI), target, off-target marker (icon + label, never color
 * only) and a 24-point sparkline.
 */

import type {KpiValue} from '@ontodecide/situation/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {AlertTriangle, Target} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Sparkline} from '../../../shared/charts/sparkline';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {kpiDelta, kpiOffTarget, kpiTrendIsGood} from '../model';

/** Props of {@link KpiCard}. */
export interface KpiCardProps {
  kpi: KpiValue;
  className?: string;
}

/** Formats a KPI number (compact above 100k). */
function kpiNumber(v: number | null): string {
  if (v === null) return '—';
  return Math.abs(v) >= 100_000 ? fmt.compact(v) : fmt.number(v);
}

/** One KPI card. */
export function KpiCard({kpi, className}: KpiCardProps) {
  const {t, i18n} = useTranslation('cockpit');
  const name = resolveText(kpi.name, i18n.language, kpi.id);
  const delta = kpiDelta(kpi);
  const good = kpiTrendIsGood(kpi);
  const off = kpiOffTarget(kpi);
  const value = kpiNumber(kpi.value);

  let change: string | null = null;
  if (delta) {
    change =
      delta.rel !== null
        ? fmt.percent(Math.abs(delta.rel), 1)
        : fmt.number(Math.abs(delta.abs));
  }
  const dir =
    !delta || delta.abs === 0 ? 'flat' : delta.abs > 0 ? 'up' : 'down';
  const trend = good === null ? 'flat' : good ? 'good' : 'bad';

  return (
    <article
      aria-label={name}
      className={cn(
        'glass flex min-w-0 flex-col gap-1.5 px-4 py-3.5',
        off && 'ring-1 ring-crit/40',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs leading-5 font-medium text-muted">{name}</h3>
        {off && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-crit/40 bg-crit/10 px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-crit"
            data-testid="kpi-off-target"
          >
            <AlertTriangle className="size-3" aria-hidden />
            {t('kpi.offTarget')}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            key={value}
            data-testid="kpi-value"
            className={cn(
              'num fade-in text-[2rem] leading-none font-semibold tracking-tight',
              off ? 'text-crit' : 'text-text',
            )}
          >
            {value}
          </span>
          {kpi.unit && kpi.value !== null && (
            <span className="text-xs text-muted">{kpi.unit}</span>
          )}
        </div>
        <div className="shrink-0 opacity-90">
          <Sparkline
            values={kpi.spark}
            width={96}
            height={30}
            label={t('kpi.spark', {name})}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        {change !== null ? (
          <span
            data-testid="kpi-delta"
            data-trend={trend}
            className={cn(
              'num inline-flex items-center gap-1 whitespace-nowrap',
              trend === 'good'
                ? 'text-good'
                : trend === 'bad'
                  ? 'text-crit'
                  : 'text-muted',
            )}
          >
            <span aria-hidden>
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'}
            </span>
            <span className="sr-only">
              {t(`kpi.${dir}`)}
              {trend !== 'flat' &&
                ` ${t(trend === 'good' ? 'kpi.better' : 'kpi.worse')} `}
            </span>
            {t('kpi.vsYesterday', {change})}
          </span>
        ) : (
          <span className="text-dim" data-testid="kpi-delta">
            —
          </span>
        )}
        {kpi.target !== null && (
          <span className="num inline-flex items-center gap-1 whitespace-nowrap text-dim">
            <Target className="size-3" aria-hidden />
            {t('kpi.target', {
              value: `${fmt.number(kpi.target)}${kpi.unit ? ` ${kpi.unit}` : ''}`,
            })}
          </span>
        )}
      </div>
    </article>
  );
}
