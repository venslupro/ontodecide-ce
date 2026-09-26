/**
 * @fileoverview Free-tier quota panel: horizontal bar chart of today's
 * ratio per resource with the 80% warning line, plus an accessible table
 * (used / limit / ratio / status with icon + text).
 */

import {
  USAGE_DAILY_LIMITS,
  USAGE_RESOURCES,
  type UsageResource,
} from '@ontodecide/shared-kernel';
import type {EChartsCoreOption} from 'echarts/core';
import {Gauge, RotateCw} from 'lucide-react';
import {useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import type {AdminUsage} from '../../features/situation/api';
import {axisStyle, EChart} from '../../shared/charts/chart';
import type {ChartTokens} from '../../shared/charts/theme';
import {fmt} from '../../shared/lib/format';
import {StatusBadge, type StatusLevel} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {Progress, usageTone} from '../../shared/ui/progress';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';

/** One resource row. */
export interface UsageRow {
  resource: UsageResource;
  label: string;
  ratio: number;
  used: number;
  limit: number;
  tone: 'good' | 'warn' | 'crit';
}

/** Builds the rows for all tracked resources. */
export function usageRows(
  usage: AdminUsage | undefined,
  label: (r: UsageResource) => string,
): UsageRow[] {
  return USAGE_RESOURCES.map(resource => {
    const limit = usage?.limits?.[resource] ?? USAGE_DAILY_LIMITS[resource];
    const used = usage?.used?.[resource] ?? 0;
    const ratio = usage?.ratios?.[resource] ?? (limit ? used / limit : 0);
    return {
      resource,
      label: label(resource),
      ratio,
      used,
      limit,
      tone: usageTone(ratio),
    };
  });
}

const LEVEL: Record<UsageRow['tone'], StatusLevel> = {
  good: 'good',
  warn: 'warn',
  crit: 'crit',
};

/** Quota panel. */
export function UsagePanel({
  usage,
  loading,
  onRefresh,
}: {
  usage: AdminUsage | undefined;
  loading: boolean;
  onRefresh(): void;
}) {
  const {t} = useTranslation('admin');
  const rows = useMemo(
    () =>
      usageRows(usage, r => t(`common:quota.resources.${r.replace('.', '_')}`)),
    [usage, t],
  );
  const statusText = useCallback(
    (tone: UsageRow['tone']) =>
      tone === 'crit'
        ? t('common:quota.critical')
        : tone === 'warn'
          ? t('common:quota.warning')
          : t('health.usageOk'),
    [t],
  );
  const option = useMemo(() => {
    const data = [...rows].reverse();
    const max = Math.max(1, ...data.map(r => r.ratio));
    return (tk: ChartTokens): EChartsCoreOption => ({
      grid: {left: 8, right: 48, top: 16, bottom: 8, containLabel: true},
      tooltip: {
        trigger: 'axis',
        axisPointer: {type: 'shadow'},
        valueFormatter: (v: number) => fmt.percent(v, 1),
      },
      xAxis: {
        type: 'value',
        max,
        ...axisStyle(tk),
        axisLabel: {
          ...axisStyle(tk).axisLabel,
          formatter: (v: number) => fmt.percent(v),
        },
      },
      yAxis: {
        type: 'category',
        data: data.map(r => r.label),
        ...axisStyle(tk),
        splitLine: {show: false},
        axisLabel: {color: tk.muted, fontSize: 12},
      },
      series: [
        {
          type: 'bar',
          barWidth: 12,
          data: data.map(r => ({
            value: r.ratio,
            itemStyle: {color: tk[r.tone], borderRadius: [0, 4, 4, 0]},
          })),
          label: {
            show: true,
            position: 'right',
            color: tk.text,
            fontSize: 11,
            formatter: (p: {value: number}) => fmt.percent(p.value, 1),
          },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: {color: tk.warn, type: 'dashed', width: 1.5},
            label: {
              color: tk.warn,
              formatter: t('health.warnLine'),
              position: 'end',
            },
            data: [{xAxis: 0.8}],
          },
        },
      ],
    });
  }, [rows, t]);

  const worst = rows.reduce<UsageRow['tone']>(
    (w, r) =>
      r.tone === 'crit' || (r.tone === 'warn' && w === 'good') ? r.tone : w,
    'good',
  );

  return (
    <Panel
      title={t('health.usageTitle')}
      subtitle={
        usage?.day ? t('health.usageSubtitle', {day: usage.day}) : undefined
      }
      icon={<Gauge aria-hidden />}
      actions={
        <>
          <StatusBadge level={LEVEL[worst]}>{statusText(worst)}</StatusBadge>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('common:actions.refresh')}
            onClick={onRefresh}
            disabled={loading}
          >
            <RotateCw
              aria-hidden
              className={loading ? 'animate-spin' : undefined}
            />
          </Button>
        </>
      }
    >
      <EChart
        option={option}
        height={260}
        ariaLabel={t('health.usageChartAria')}
      />
      <Table aria-label={t('health.usageTableAria')} className="mt-2">
        <THead>
          <tr className="border-b border-line">
            <Th>{t('health.resource')}</Th>
            <Th className="text-right">{t('health.usedLimit')}</Th>
            <Th className="w-40">{t('health.ratio')}</Th>
            <Th>{t('fields.status')}</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map(r => (
            <Tr key={r.resource}>
              <Td className="whitespace-nowrap">{r.label}</Td>
              <Td className="num text-right whitespace-nowrap text-muted">
                {fmt.number(r.used)} / {fmt.number(r.limit)}
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <Progress
                    value={r.ratio}
                    tone={r.tone}
                    marker={0.8}
                    label={r.label}
                  />
                  <span className="num w-12 text-right text-xs">
                    {fmt.percent(r.ratio, 1)}
                  </span>
                </div>
              </Td>
              <Td>
                <StatusBadge level={LEVEL[r.tone]}>
                  {statusText(r.tone)}
                </StatusBadge>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}
