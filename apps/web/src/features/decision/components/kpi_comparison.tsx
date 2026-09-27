/**
 * @fileoverview Three-way comparison 基线 / 情景 / 情景 + 动作: bar chart and
 * KPI table with units and good/bad colouring by `higherIsBetter`. All
 * values come straight from the deterministic simulator (never an LLM).
 */

import type {
  KpiMeta,
  KpiSet,
  ScenarioResult,
} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import type {EChartsCoreOption} from 'echarts/core';
import {ArrowDown, ArrowUp, Cpu, Minus} from 'lucide-react';
import {useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {axisStyle, EChart} from '../../../shared/charts/chart';
import type {ChartTokens} from '../../../shared/charts/theme';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {kpiRows, kpiTrend} from '../model';

/** Formats a KPI value with its unit (`91.4%`, `37`, `4,800 ¥`). */
export function formatKpi(
  v: number | undefined,
  meta: Pick<KpiMeta, 'unit'>,
): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const n = fmt.number(v, {maximumFractionDigits: 2});
  if (!meta.unit) return n;
  return meta.unit === '%' ? `${n}%` : `${n} ${meta.unit}`;
}

function Value({
  meta,
  from,
  value,
}: {
  meta: KpiMeta;
  from?: number;
  value?: number;
}) {
  const {t} = useTranslation('scenarios');
  const trend = from === undefined ? 'flat' : kpiTrend(meta, from, value);
  const up = value !== undefined && from !== undefined && value > from;
  const Icon = trend === 'flat' ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-end gap-1 num',
        trend === 'good'
          ? 'text-good'
          : trend === 'bad'
            ? 'text-orange'
            : 'text-text',
      )}
    >
      {from !== undefined && trend !== 'flat' && (
        <Icon className="size-3.5" aria-hidden />
      )}
      <span>{formatKpi(value, meta)}</span>
      {from !== undefined && trend !== 'flat' && (
        <span className="sr-only">{t(`compare.trend.${trend}`)}</span>
      )}
    </span>
  );
}

/** Grouped bar chart (values as % of baseline; tooltip shows raw values). */
export function KpiChart({
  result,
  withActions,
  height = 220,
}: {
  result: ScenarioResult;
  withActions?: KpiSet;
  height?: number;
}) {
  const {t, i18n} = useTranslation('scenarios');
  const names = useMemo(
    () =>
      result.kpis.map(k =>
        resolveText(k.displayName, i18n.language, k.apiName),
      ),
    [result.kpis, i18n.language],
  );
  const option = useCallback(
    (tk: ChartTokens): EChartsCoreOption => {
      const sets = [result.baseline, result.scenario, withActions];
      const labels = [
        t('compare.baseline'),
        t('compare.scenario'),
        t('compare.withActions'),
      ];
      const colors = [tk.muted, tk.orange, tk.cyan];
      const used = withActions ? [0, 1, 2] : [0, 1];
      const pct = (set: KpiSet | undefined, k: KpiMeta) => {
        const b = result.baseline[k.apiName];
        const v = set?.[k.apiName];
        if (v === undefined || !b) return null;
        return Math.round((v / b) * 1000) / 10;
      };
      return {
        legend: {
          top: 0,
          right: 0,
          textStyle: {color: tk.muted, fontSize: 11},
          itemWidth: 10,
          itemHeight: 10,
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: {type: 'shadow'},
          formatter: (
            ps: {
              seriesIndex: number;
              dataIndex: number;
              marker: string;
              seriesName: string;
            }[],
          ) => {
            const i = ps[0]?.dataIndex ?? 0;
            const k = result.kpis[i];
            return [
              names[i],
              ...ps.map(
                p =>
                  `${p.marker}${p.seriesName}: ${formatKpi(sets[used[p.seriesIndex]]?.[k.apiName], k)}`,
              ),
            ].join('<br/>');
          },
        },
        grid: {left: 8, right: 12, top: 32, bottom: 8, containLabel: true},
        xAxis: {
          type: 'category',
          data: names,
          ...axisStyle(tk),
          splitLine: {show: false},
        },
        yAxis: {
          type: 'value',
          ...axisStyle(tk),
          axisLabel: {...axisStyle(tk).axisLabel, formatter: '{value}%'},
        },
        series: used.map(si => ({
          name: labels[si],
          type: 'bar',
          barMaxWidth: 26,
          barGap: '20%',
          itemStyle: {borderRadius: [4, 4, 0, 0], color: colors[si]},
          data: result.kpis.map(k => pct(sets[si], k)),
        })),
      };
    },
    [result, withActions, names, t],
  );
  return (
    <EChart
      option={option}
      height={height}
      ariaLabel={t('compare.chartAria', {kpis: names.join(', ')})}
    />
  );
}

/** KPI table: KPI, 基线, 情景 (vs baseline), +动作 (vs scenario). */
export function KpiTable({
  result,
  withActions,
}: {
  result: ScenarioResult;
  withActions?: KpiSet;
}) {
  const {t, i18n} = useTranslation('scenarios');
  return (
    <Table aria-label={t('compare.tableAria')}>
      <THead>
        <Tr>
          <Th>{t('compare.kpi')}</Th>
          <Th className="text-right">{t('compare.baseline')}</Th>
          <Th className="text-right">{t('compare.scenario')}</Th>
          <Th className="text-right">{t('compare.withActionsShort')}</Th>
        </Tr>
      </THead>
      <TBody>
        {kpiRows(result, withActions).map(r => (
          <Tr key={r.meta.apiName} data-testid="kpi-row">
            <Td className="font-medium">
              {resolveText(r.meta.displayName, i18n.language, r.meta.apiName)}
            </Td>
            <Td className="text-right">
              <Value meta={r.meta} value={r.baseline} />
            </Td>
            <Td className="text-right">
              <Value meta={r.meta} from={r.baseline} value={r.scenario} />
            </Td>
            <Td className="text-right">
              <Value meta={r.meta} from={r.scenario} value={r.withActions} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** The 「数值由确定性推演器计算，不经过 LLM」 note. */
export function DeterministicNote() {
  const {t} = useTranslation('scenarios');
  return (
    <p className="flex items-center gap-1.5 text-xs text-dim">
      <Cpu className="size-3.5" aria-hidden />
      {t('compare.note')}
    </p>
  );
}
