/**
 * @fileoverview 关键指标趋势: 24h / 7d lines (2 px, area gradient, ≤ 2
 * series labelled directly) with alert instants marked by red dashed
 * lines and labels. ECharts is loaded on demand.
 */

import {resolveText} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  KpiTrend,
  KpiValue,
} from '@ontodecide/situation/contract';
import type {EChartsCoreOption} from 'echarts/core';
import {useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {axisStyle, EChart} from '../../../shared/charts/chart';
import type {ChartTokens} from '../../../shared/charts/theme';
import {fmt} from '../../../shared/lib/format';
import {alertMarkers, trendOf} from '../model';

/** Builds the ECharts option (pure; exported for tests). */
export function trendOption(
  tk: ChartTokens,
  series: {name: string; points: KpiTrend['points']; color: string}[],
  markers: {ts: string; title: string}[],
  range: '24h' | '7d',
): EChartsCoreOption {
  const ax = axisStyle(tk);
  const fmtTs = (v: number) => (range === '24h' ? fmt.time(v) : fmt.date(v));
  return {
    legend: {
      top: 0,
      right: 0,
      textStyle: {color: tk.muted, fontSize: 11},
      icon: 'roundRect',
    },
    tooltip: {trigger: 'axis'},
    xAxis: {
      type: 'time',
      ...ax,
      splitLine: {show: false},
      axisLabel: {...ax.axisLabel, formatter: fmtTs},
    },
    yAxis: series.map((_, i) => ({
      type: 'value',
      scale: true,
      show: i === 0,
      ...ax,
    })),
    series: series.map((s, i) => ({
      name: s.name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      yAxisIndex: i,
      lineStyle: {width: 2, color: s.color},
      itemStyle: {color: s.color},
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            {offset: 0, color: `${s.color}55`},
            {offset: 1, color: `${s.color}00`},
          ],
        },
      },
      data: s.points.map(p => [Date.parse(p.ts), p.value]),
      ...(i === 0 && markers.length
        ? {
            markLine: {
              symbol: 'none',
              lineStyle: {color: tk.crit, type: 'dashed', width: 1},
              label: {
                color: tk.crit,
                formatter: '{b}',
                fontSize: 10,
                position: 'insideEndTop',
              },
              data: markers.map(m => ({
                name: m.title,
                xAxis: Date.parse(m.ts),
              })),
            },
          }
        : {}),
    })),
  };
}

/** Trend widget. */
export function TrendWidget({
  kpis,
  trends,
  alerts,
  range,
}: {
  kpis: readonly KpiValue[];
  trends: readonly KpiTrend[];
  alerts: readonly AlertDto[];
  range: '24h' | '7d';
}) {
  const {t, i18n} = useTranslation('cockpit');
  const shown = kpis.slice(0, 2);
  const from = Date.now() - (range === '24h' ? 24 : 24 * 7) * 3600_000;
  const markers = alertMarkers(alerts, from, 3);
  const key = JSON.stringify([
    shown.map(k => k.id),
    trends,
    markers,
    range,
    i18n.language,
  ]);
  const option = useCallback(
    (tk: ChartTokens) =>
      trendOption(
        tk,
        shown.map((k, i) => ({
          name: `${resolveText(k.name, i18n.language, k.id)}${k.unit ? ` ${k.unit}` : ''}`,
          points: trendOf(trends, k.id),
          color: i === 0 ? tk.cyan : tk.orange,
        })),
        markers,
        range,
      ),
    [key],
  );
  const label = t('trend.aria', {
    series: shown.map(k => resolveText(k.name, i18n.language, k.id)).join('、'),
    range: t(`range.${range}`),
    alerts: markers.length,
  });
  return (
    <div>
      <EChart option={option} height={300} ariaLabel={label} />
      {markers.length > 0 && (
        <ul className="sr-only">
          {markers.map(m => (
            <li key={m.ts + m.title}>
              {fmt.dateTime(m.ts)} {m.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
