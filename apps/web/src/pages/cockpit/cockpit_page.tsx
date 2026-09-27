/**
 * @fileoverview 态势总览 (/cockpit), fixed layout (no configurable widgets,
 * no wall mode): expiry banner (≤ 24 h), KPI cards, 24h / 7d trend with
 * alert markers, live alert stream, impacted objects, 「我的试用额度」 and
 * pending recommendations. An empty workspace offers 「加载示例场景」 and
 * 「导入文件」. Realtime increments arrive through the shared stream into the
 * same query cache.
 */

import {useNavigate} from '@tanstack/react-router';
import {FlaskConical, Sparkles} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {ExpiryBanner} from '../../app/layouts/banners';
import {QuotaBars} from '../../entities/quota';
import {useObjectStats} from '../../features/object-graph/api';
import {useOverview, type Range} from '../../features/situation/api';
import {AlertStream} from '../../features/situation/components/alert_stream';
import {EmptyWorkspace} from '../../features/situation/components/empty_workspace';
import {ImpactedObjects} from '../../features/situation/components/impacted_objects';
import {KpiCard} from '../../features/situation/components/kpi_card';
import {PendingRecommendations} from '../../features/situation/components/pending_recommendations';
import {TrendWidget} from '../../features/situation/components/trend_widget';
import {
  isEmptyWorkspace,
  sortAlertsBySeverity,
  trendOf,
} from '../../features/situation/model';
import {useRecommendationMerger} from '../../features/situation/stream';
import {
  searchString,
  useLooseSearch,
  useSearchPatch,
} from '../../features/object-graph/search_params';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Tabs, TabsList, TabsTrigger} from '../../shared/ui/tabs';
import {useRealtimeStatus} from '../../shared/ws';

function LiveDot() {
  const {t} = useTranslation('cockpit');
  const state = useRealtimeStatus(s => s.state);
  const live = state === 'open';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span
        aria-hidden
        className={
          live ? 'size-2 rounded-full bg-good' : 'size-2 rounded-full bg-warn'
        }
      />
      {t(`live.${live ? 'open' : 'other'}`)}
    </span>
  );
}

/** Cockpit page. */
export function CockpitPage() {
  const {t} = useTranslation('cockpit');
  const navigate = useNavigate();
  const search = useLooseSearch();
  const patch = useSearchPatch();
  const range: Range = searchString(search, 'range') === '7d' ? '7d' : '24h';
  const ov = useOverview(range);
  const stats = useObjectStats();
  useRecommendationMerger();

  const data = ov.data;
  const empty = isEmptyWorkspace(data, stats.data?.objects);
  const crit = (data?.alerts ?? []).filter(
    a =>
      a.status === 'OPEN' &&
      (a.severity === 'CRITICAL' || a.severity === 'HIGH'),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <ExpiryBanner />
      <PageHeader
        breadcrumb={t('breadcrumb')}
        title={t('title')}
        actions={
          <>
            <Tabs
              value={range}
              onValueChange={v => patch({range: v === '7d' ? '7d' : undefined})}
            >
              <TabsList aria-label={t('range.label')}>
                <TabsTrigger value="24h">{t('range.24h')}</TabsTrigger>
                <TabsTrigger value="7d">{t('range.7d')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="primary"
              onClick={() => void navigate({to: '/scenarios'})}
            >
              <FlaskConical aria-hidden />
              {t('runScenario')}
            </Button>
          </>
        }
      />

      {ov.error ? (
        <ErrorView
          traceId={errorTraceId(ov.error)}
          detail={errorMessage(ov.error, t)}
          onRetry={() => void ov.refetch()}
        />
      ) : ov.isLoading || !data ? (
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({length: 4}, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          {empty && <EmptyWorkspace />}
          <section
            aria-label={t('kpi.section')}
            className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4"
          >
            {data.kpis.slice(0, 4).map((k, i) => (
              <KpiCard
                key={k.id}
                kpi={k}
                index={i}
                points={trendOf(data.trends, k.id)}
              />
            ))}
          </section>

          <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <Panel title={t('trend.title')}>
              <TrendWidget
                kpis={data.kpis}
                trends={data.trends}
                alerts={data.alerts}
                range={range}
              />
            </Panel>
            <Panel
              title={t('alerts.title')}
              actions={
                <>
                  {crit > 0 && (
                    <Badge tone="crit">
                      {t('alerts.critical', {count: crit})}
                    </Badge>
                  )}
                  <LiveDot />
                </>
              }
            >
              <AlertStream alerts={sortAlertsBySeverity(data.alerts)} />
            </Panel>
          </div>

          <div className="grid gap-3.5 lg:grid-cols-3">
            <Panel
              title={t('impacted.title')}
              subtitle={t('impacted.subtitle')}
            >
              <ImpactedObjects items={data.impacted} />
            </Panel>
            <Panel title={t('quota.title')} subtitle={t('quota.reset')}>
              <QuotaBars
                keys={['objects', 'links', 'aiRecsToday', 'importRowsToday']}
              />
            </Panel>
            <Panel
              title={t('pending.title')}
              icon={<Sparkles aria-hidden />}
              actions={
                <Badge tone="cyan">
                  {data.pendingRecommendations?.length ?? 0}
                </Badge>
              }
            >
              <PendingRecommendations
                recs={data.pendingRecommendations ?? []}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
