/**
 * @fileoverview Three-way KPI comparison (baseline / scenario / scenario +
 * action): grouped bar chart and KPI table. All values come straight from the
 * simulator; the UI only derives relative deltas.
 */

import type {
  KpiMeta,
  KpiSet,
  ScenarioResult,
} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import type {EChartsCoreOption} from 'echarts/core';
import {Minus, TrendingDown, TrendingUp} from 'lucide-react';
import {useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {axisStyle, EChart} from '../../../shared/charts/chart';
import {type ChartTokens, seriesColors} from '../../../shared/charts/theme';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {kpiTrend, relDelta} from '../model';

/** Grouped bar chart of the KPIs, normalized to % of baseline (tooltip shows raw values). */
export function KpiChart({
  result,
  withAction,
  height = 240,
}: {
  result: Pick<ScenarioResult, 'kpis' | 'baseline' | 'scenario'>;
  withAction?: KpiSet;
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
  const seriesNames = useMemo(
    () => [t('kpi.baseline'), t('kpi.scenario'), t('kpi.withAction')],
    [t],
  );

  const option = useCallback(
    (tk: ChartTokens): EChartsCoreOption => {
      const pct = (set: KpiSet | undefined, k: KpiMeta) => {
        const b = result.baseline[k.apiName];
        const v = set?.[k.apiName];
        if (v === undefined || !b) return null;
        return Math.round((v / b) * 1000) / 10;
      };
      const raw = [result.baseline, result.scenario, withAction];
      const colors = seriesColors(tk);
      const sets = withAction ? raw : raw.slice(0, 2);
      return {
        color: colors,
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
            params: {
              seriesIndex: number;
              dataIndex: number;
              marker: string;
              seriesName: string;
            }[],
          ) => {
            const i = params[0]?.dataIndex ?? 0;
            const k = result.kpis[i];
            const lines = params.map(p => {
              const v = raw[p.seriesIndex]?.[k.apiName];
              return `${p.marker}${p.seriesName}: ${fmt.number(v)}${k.unit ? ` ${k.unit}` : ''}`;
            });
            return [names[i], ...lines].join('<br/>');
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
        series: sets.map((set, si) => ({
          name: seriesNames[si],
          type: 'bar',
          barMaxWidth: 26,
          barGap: '20%',
          itemStyle: {borderRadius: [4, 4, 0, 0], color: colors[si]},
          data: result.kpis.map(k => pct(set, k)),
        })),
      };
    },
    [result, withAction, names, seriesNames],
  );

  return (
    <EChart
      option={option}
      height={height}
      ariaLabel={t('kpi.chartAria', {
        kpis: names.join('、'),
        count: withAction ? 3 : 2,
      })}
    />
  );
}

function Delta({meta, delta}: {meta: KpiMeta; delta: number | null}) {
  const {t} = useTranslation('scenarios');
  const trend = kpiTrend(meta, delta);
  if (delta === null) return <span className="text-dim">—</span>;
  const Icon = trend === 'flat' ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap num',
        trend === 'good'
          ? 'text-good'
          : trend === 'bad'
            ? 'text-crit'
            : 'text-muted',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>{fmt.signedPercent(delta)}</span>
      <span className="text-[11px]">
        {delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {t(`kpi.trend.${trend}`)}
      </span>
    </span>
  );
}

/** KPI table: baseline, scenario (Δ vs baseline), scenario + action (Δ vs scenario). */
export function KpiTable({
  result,
  withAction,
  caption,
}: {
  result: Pick<ScenarioResult, 'kpis' | 'baseline' | 'scenario'>;
  withAction?: KpiSet;
  caption?: string;
}) {
  const {t, i18n} = useTranslation('scenarios');
  return (
    <Table aria-label={caption ?? t('kpi.tableAria')}>
      <THead>
        <Tr>
          <Th>{t('kpi.name')}</Th>
          <Th>{t('kpi.unit')}</Th>
          <Th className="text-right">{t('kpi.baseline')}</Th>
          <Th className="text-right">{t('kpi.scenario')}</Th>
          <Th>{t('kpi.deltaBaseline')}</Th>
          {withAction && (
            <>
              <Th className="text-right">{t('kpi.withAction')}</Th>
              <Th>{t('kpi.deltaScenario')}</Th>
            </>
          )}
        </Tr>
      </THead>
      <TBody>
        {result.kpis.map(k => {
          const b = result.baseline[k.apiName];
          const s = result.scenario[k.apiName];
          const a = withAction?.[k.apiName];
          return (
            <Tr key={k.apiName}>
              <Td className="font-medium">
                {resolveText(k.displayName, i18n.language, k.apiName)}
              </Td>
              <Td className="text-muted">{k.unit ?? '—'}</Td>
              <Td className="text-right num">{fmt.number(b)}</Td>
              <Td className="text-right num">{fmt.number(s)}</Td>
              <Td>
                <Delta meta={k} delta={relDelta(b, s)} />
              </Td>
              {withAction && (
                <>
                  <Td className="text-right num">{fmt.number(a)}</Td>
                  <Td>
                    <Delta meta={k} delta={relDelta(s, a)} />
                  </Td>
                </>
              )}
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
