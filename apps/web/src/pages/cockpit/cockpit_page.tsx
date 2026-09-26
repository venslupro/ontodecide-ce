/**
 * @fileoverview 态势总览 (cockpit): widgets placed on a 12-column grid from
 * the tenant CockpitLayout (built-in default on failure), fed by the
 * overview query that the global realtime stream keeps up to date. Wall
 * mode (`?mode=wall`) hides actions, shows a compact header with a clock
 * and rotates KPI groups every 60 s; Esc exits.
 */

import type {CockpitWidget} from '@ontodecide/situation/contract';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {MonitorPlay} from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {useTranslation} from 'react-i18next';
import {useLayout, useOverview} from '../../features/situation/api';
import {AlertStream} from '../../features/situation/components/alert_stream';
import {DataHealth} from '../../features/situation/components/data_health';
import {ImpactedObjects} from '../../features/situation/components/impacted_objects';
import {KpiRow} from '../../features/situation/components/kpi_row';
import {ObjectTableWidget} from '../../features/situation/components/object_table_widget';
import {PendingRecommendations} from '../../features/situation/components/pending_recommendations';
import {RealtimeBadge} from '../../features/situation/components/realtime_badge';
import {TrendWidget} from '../../features/situation/components/trend_widget';
import {
  DEFAULT_COCKPIT_LAYOUT,
  normalizeWidgets,
  type Overview,
} from '../../features/situation/model';
import {errorMessage} from '../../shared/api/error_message';
import {fmt} from '../../shared/lib/format';
import {useInterval} from '../../shared/lib/hooks';
import {Button} from '../../shared/ui/button';
import {ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {WallHeader, WallKpis} from './wall';

/** Grid placement for a widget (applied from the `lg` breakpoint up). */
function placement(w: CockpitWidget): CSSProperties {
  return {
    '--gc': `${w.x + 1} / span ${w.w}`,
    '--gr': `${w.y + 1} / span ${w.h}`,
  } as CSSProperties;
}

function Cell({
  widget,
  children,
}: {
  widget: CockpitWidget;
  children: ReactNode;
}) {
  return (
    <div
      data-widget={widget.kind}
      className="col-span-12 flex min-w-0 flex-col lg:[grid-column:var(--gc)] lg:[grid-row:var(--gr)] [&>*]:flex-1"
      style={placement(widget)}
    >
      {children}
    </div>
  );
}

function CockpitSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-3.5" aria-hidden>
      {Array.from({length: 4}, (_, i) => (
        <Skeleton
          key={i}
          className="col-span-12 h-32 rounded-[14px] sm:col-span-6 xl:col-span-3"
        />
      ))}
      <Skeleton className="col-span-12 h-80 rounded-[14px] lg:col-span-8" />
      <Skeleton className="col-span-12 h-80 rounded-[14px] lg:col-span-4" />
      {Array.from({length: 3}, (_, i) => (
        <Skeleton
          key={`b${i}`}
          className="col-span-12 h-64 rounded-[14px] lg:col-span-4"
        />
      ))}
    </div>
  );
}

function renderWidget(
  w: CockpitWidget,
  ov: Overview,
  wall: boolean,
): ReactNode {
  switch (w.kind) {
    case 'kpi':
      return wall && !w.binding?.kpiId ? (
        <WallKpis kpis={ov.kpis} />
      ) : (
        <KpiRow kpis={ov.kpis} kpiId={w.binding?.kpiId} />
      );
    case 'trend':
      return (
        <TrendWidget
          kpis={ov.kpis}
          alerts={ov.alerts}
          defaultKpiId={w.binding?.kpiId}
        />
      );
    case 'alerts':
      return <AlertStream alerts={ov.alerts} readOnly={wall} />;
    case 'recommendations':
      return (
        <PendingRecommendations
          recommendations={ov.recommendations}
          readOnly={wall}
        />
      );
    case 'impacted':
      return <ImpactedObjects recommendations={ov.recommendations} />;
    case 'dataHealth':
      return <DataHealth sources={ov.dataHealth ?? []} />;
    case 'objectTable':
      return w.binding?.objectSetId ? (
        <ObjectTableWidget objectSetId={w.binding.objectSetId} />
      ) : null;
    default:
      return null;
  }
}

/** Cockpit page. */
export function CockpitPage() {
  const {t} = useTranslation('cockpit');
  const search = useSearch({strict: false}) as {mode?: string};
  const wall = search.mode === 'wall';
  const navigate = useNavigate();
  const overview = useOverview();
  const layout = useLayout();
  // Re-render relative times periodically.
  const [, setTick] = useState(0);
  useInterval(() => setTick(n => n + 1), 30_000);

  useEffect(() => {
    if (!wall) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void navigate({to: '/cockpit', search: {}});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wall, navigate]);

  const widgets = useMemo(() => {
    const src = layout.data?.widgets?.length
      ? layout.data.widgets
      : DEFAULT_COCKPIT_LAYOUT.widgets;
    return normalizeWidgets(src).filter(
      w => w.kind !== 'objectTable' || !!w.binding?.objectSetId,
    );
  }, [layout.data]);

  const ov = overview.data;
  const updated = ov?.generatedAt
    ? t('updatedAt', {time: fmt.dateTime(ov.generatedAt)})
    : undefined;

  return (
    <div className="flex flex-col">
      {wall ? (
        <WallHeader updated={updated} />
      ) : (
        <PageHeader
          title={t('title')}
          description={t('description')}
          badges={<RealtimeBadge />}
          actions={
            <>
              {updated && <span className="text-xs text-dim">{updated}</span>}
              <Button asChild variant="secondary" size="sm">
                <Link to="/cockpit" search={{mode: 'wall'}}>
                  <MonitorPlay aria-hidden />
                  {t('wallMode')}
                </Link>
              </Button>
            </>
          }
        />
      )}
      {overview.isLoading || (layout.isLoading && layout.failureCount === 0) ? (
        <CockpitSkeleton />
      ) : overview.isError || !ov ? (
        <ErrorView
          title={t('loadFailed')}
          detail={overview.error ? errorMessage(overview.error, t) : undefined}
          onRetry={() => void overview.refetch()}
          className="glass"
        />
      ) : (
        <div className="grid grid-cols-12 gap-3.5 lg:auto-rows-[minmax(4.5rem,auto)]">
          {widgets.map(w => {
            const node = renderWidget(w, ov, wall);
            return node ? (
              <Cell key={w.id} widget={w}>
                {node}
              </Cell>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
