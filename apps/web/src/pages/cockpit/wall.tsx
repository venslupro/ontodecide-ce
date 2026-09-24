/**
 * @fileoverview Wall-mode pieces: compact header (brand, clock, realtime
 * status) and KPI groups of four that rotate every 60 s with an indicator.
 */

import type {KpiValue} from '@ontodecide/situation/contract';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {KpiRow} from '../../features/situation/components/kpi_row';
import {RealtimeBadge} from '../../features/situation/components/realtime_badge';
import {chunk} from '../../features/situation/model';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {useInterval} from '../../shared/lib/hooks';

/** KPI rotation interval in wall mode. */
export const WALL_ROTATE_MS = 60_000;

/** KPIs per wall-mode group. */
export const WALL_GROUP_SIZE = 4;

/** Compact wall header. */
export function WallHeader({updated}: {updated?: string}) {
  const {t} = useTranslation('cockpit');
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), 1000);
  return (
    <header
      className="mb-4 flex flex-wrap items-center justify-between gap-3"
      data-testid="wall-header"
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="text-gradient text-lg font-semibold tracking-tight">
          {t('wall.brand')}
        </span>
        <h1 className="text-base font-medium text-muted">{t('title')}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {updated && <span className="text-xs text-dim">{updated}</span>}
        <RealtimeBadge />
        <time
          className="num text-lg font-semibold text-text"
          dateTime={new Date(now).toISOString()}
        >
          {fmt.time(now)}
        </time>
        <span className="text-xs text-dim">{t('wall.exitHint')}</span>
      </div>
    </header>
  );
}

/** Rotating KPI groups. */
export function WallKpis({kpis}: {kpis: readonly KpiValue[]}) {
  const {t} = useTranslation('cockpit');
  const groups = chunk(kpis, WALL_GROUP_SIZE);
  const [index, setIndex] = useState(0);
  useInterval(
    () => setIndex(i => (i + 1) % Math.max(1, groups.length)),
    groups.length > 1 ? WALL_ROTATE_MS : null,
  );
  const current = groups.length ? Math.min(index, groups.length - 1) : 0;
  return (
    <div className="flex flex-col gap-2">
      <KpiRow key={current} kpis={groups[current] ?? []} className="fade-in" />
      {groups.length > 1 && (
        <div
          className="flex items-center justify-center gap-1.5"
          role="status"
          aria-label={t('wall.group', {
            current: current + 1,
            total: groups.length,
          })}
        >
          {groups.map((_, i) => (
            <span
              key={i}
              aria-hidden
              title={t('wall.groupDot', {n: i + 1})}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === current ? 'w-6 bg-cyan' : 'w-1.5 bg-line-2',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
