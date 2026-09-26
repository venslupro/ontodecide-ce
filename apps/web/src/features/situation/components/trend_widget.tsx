/**
 * @fileoverview KPI trend widget: 24h / 7d toggle, KPI selector and an
 * ECharts line (2 px, area gradient) with alert times drawn as red dashed
 * vertical markLines.
 */

import type {AlertDto, KpiValue} from '@ontodecide/situation/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {LineChart} from 'lucide-react';
import {useCallback, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {axisStyle, EChart} from '../../../shared/charts/chart';
import type {ChartTokens} from '../../../shared/charts/theme';
import {fmt} from '../../../shared/lib/format';
import {Panel} from '../../../shared/ui/card';
import {EmptyState, ErrorView} from '../../../shared/ui/empty_state';
import {NativeSelect} from '../../../shared/ui/select';
import {Skeleton} from '../../../shared/ui/skeleton';
import {Tabs, TabsList, TabsTrigger} from '../../../shared/ui/tabs';
import {useKpiTrend} from '../api';

/** Trend range. */
export type TrendRange = '24h' | '7d';

const RANGE_MS: Record<TrendRange, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
};

/** Adds alpha to a `#rrggbb` color (other formats are returned unchanged). */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Alerts raised inside the window ending at `end` (epoch ms). */
export function alertsInRange(
  alerts: readonly AlertDto[],
  range: TrendRange,
  end: number,
): AlertDto[] {
  const start = end - RANGE_MS[range];
  return alerts.filter(a => {
    const ts = Date.parse(a.raisedAt);
    return Number.isFinite(ts) && ts >= start && ts <= end;
  });
}

/** Trend chart widget. */
export function TrendWidget({
  kpis,
  alerts,
  defaultKpiId,
  className,
  compact,
}: {
  kpis: readonly KpiValue[];
  alerts: readonly AlertDto[];
  defaultKpiId?: string;
  className?: string;
  /** Hides the KPI selector and range toggle. */
  compact?: boolean;
}) {
  const {t, i18n} = useTranslation('cockpit');
  const [range, setRange] = useState<TrendRange>('24h');
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const kpiId =
    picked ??
    (defaultKpiId && kpis.some(k => k.id === defaultKpiId)
      ? defaultKpiId
      : kpis[0]?.id);
  const kpi = kpis.find(k => k.id === kpiId);
  const q = useKpiTrend(kpiId, range);
  const points = useMemo(() => q.data ?? [], [q.data]);
  const name = kpi ? resolveText(kpi.name, i18n.language, kpi.id) : '';

  const marks = useMemo(() => {
    const end = points.length
      ? Math.max(Date.parse(points[points.length - 1].ts), Date.now())
      : Date.now();
    const start = points.length
      ? Date.parse(points[0].ts)
      : end - RANGE_MS[range];
    return alertsInRange(alerts, range, end).filter(
      a => Date.parse(a.raisedAt) >= start,
    );
  }, [alerts, points, range]);

  const option = useCallback(
    (tk: ChartTokens) => ({
      grid: {left: 8, right: 16, top: 28, bottom: 8, containLabel: true},
      tooltip: {trigger: 'axis', valueFormatter: (v: number) => fmt.number(v)},
      xAxis: {
        type: 'time',
        ...axisStyle(tk),
        splitLine: {show: false},
        axisLabel: {
          ...axisStyle(tk).axisLabel,
          formatter: (v: number) =>
            range === '24h' ? fmt.time(v) : fmt.date(v),
          hideOverlap: true,
        },
      },
      yAxis: {
        type: 'value',
        scale: true,
        ...axisStyle(tk),
        axisLine: {show: false},
      },
      series: [
        {
          type: 'line',
          name,
          smooth: true,
          showSymbol: false,
          data: points.map(p => [p.ts, p.value]),
          lineStyle: {width: 2, color: tk.cyan},
          itemStyle: {color: tk.cyan},
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                {offset: 0, color: withAlpha(tk.cyan, 0.32)},
                {offset: 1, color: withAlpha(tk.cyan, 0)},
              ],
            },
          },
          markLine: {
            silent: false,
            symbol: 'none',
            lineStyle: {type: 'dashed', color: tk.crit, width: 1.5},
            label: {
              color: tk.crit,
              fontSize: 10,
              formatter: (p: {name?: string}) => p.name ?? '',
              position: 'insideEndTop',
            },
            data: marks.map(a => ({
              name: `${t('trend.alertMarker')} · ${t(`common:severity.${a.severity}`)}`,
              xAxis: a.raisedAt,
            })),
          },
        },
      ],
    }),
    [points, marks, name, range, t],
  );

  const rangeLabel = t(
    range === '24h' ? 'common:time.range24h' : 'common:time.range7d',
  );

  return (
    <Panel
      title={t('trend.title')}
      icon={<LineChart aria-hidden />}
      className={className}
      actions={
        !compact && (
          <>
            {kpis.length > 1 && (
              <NativeSelect
                size="sm"
                className="w-auto max-w-48"
                aria-label={t('trend.kpi')}
                value={kpiId ?? ''}
                options={kpis.map(k => ({
                  value: k.id,
                  label: resolveText(k.name, i18n.language, k.id),
                }))}
                onChange={e => setPicked(e.target.value)}
              />
            )}
            <Tabs value={range} onValueChange={v => setRange(v as TrendRange)}>
              <TabsList aria-label={t('trend.range')}>
                <TabsTrigger value="24h">
                  {t('common:time.range24h')}
                </TabsTrigger>
                <TabsTrigger value="7d">{t('common:time.range7d')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        )
      }
    >
      {!kpi ? (
        <EmptyState title={t('trend.empty')} className="py-8" />
      ) : q.isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : q.isError ? (
        <ErrorView onRetry={() => void q.refetch()} className="py-6" />
      ) : points.length === 0 ? (
        <EmptyState title={t('trend.empty')} className="py-8" />
      ) : (
        <EChart
          option={option}
          height={260}
          ariaLabel={t('trend.aria', {
            name,
            range: rangeLabel,
            count: marks.length,
          })}
        />
      )}
    </Panel>
  );
}
