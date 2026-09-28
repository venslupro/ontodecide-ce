/**
 * @fileoverview Recommendation center (前端详细设计 建议中心, 效果图 c7):
 * `/recommendations` and `/recommendations/$id`. Left: list filtered by
 * 待确认 / 已执行 / 全部 (`?tab=`); right: the selected recommendation with
 * the Owner decision (确认并执行 / 驳回). Selecting an item navigates.
 */

import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import {Inbox} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {
  useRecommendation,
  useRecommendations,
} from '../../features/decision/api';
import {RecommendationDetail} from '../../features/decision/components/recommendation_detail';
import {RecStatusBadge} from '../../features/decision/components/rec_status_badge';
import {
  REC_TABS,
  type RecTab,
  routeId,
  tabStatus,
  toRecTab,
} from '../../features/decision/model';
import {
  searchString,
  useLooseSearch,
  useSearchPatch,
} from '../../features/object-graph/search_params';
import {isApiError} from '../../shared/api/errors';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {Button} from '../../shared/ui/button';
import {Card} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Tabs, TabsList, TabsTrigger} from '../../shared/ui/tabs';

function RecList({tab, selectedId}: {tab: RecTab; selectedId?: string}) {
  const {t} = useTranslation('recommendations');
  const navigate = useNavigate();
  const q = useRecommendations(tabStatus(tab));
  const items = q.data?.pages.flatMap(p => p.items) ?? [];

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-2 p-3">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  if (q.error)
    return (
      <ErrorView
        traceId={errorTraceId(q.error)}
        title={t('list.error')}
        detail={errorMessage(q.error, t)}
        onRetry={() => void q.refetch()}
      />
    );
  if (!items.length)
    return (
      <EmptyState
        icon={<Inbox aria-hidden />}
        title={t('list.empty')}
        description={t('list.emptyHint')}
      />
    );
  return (
    <div className="flex flex-col gap-2 p-3">
      <ul className="flex flex-col gap-2" aria-label={t('list.aria')}>
        {items.map(r => (
          <li key={r.id}>
            <button
              type="button"
              data-testid="rec-item"
              aria-current={r.id === selectedId || undefined}
              onClick={() =>
                void navigate({
                  to: '/recommendations/$id',
                  params: {id: r.id},
                  search: {tab} as never,
                })
              }
              className={cn(
                'flex w-full flex-col gap-1 rounded-[12px] border px-3.5 py-3 text-left transition-colors',
                r.id === selectedId
                  ? 'border-cyan/60 bg-cyan/5'
                  : 'border-line bg-panel-2 hover:border-line-2',
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium text-text">
                  {r.summary}
                </span>
                <RecStatusBadge status={r.status} className="shrink-0" />
              </span>
              <span className="text-xs text-dim">{fmt.ago(r.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          loading={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {t('list.loadMore')}
        </Button>
      )}
    </div>
  );
}

function DetailPane({id}: {id?: string}) {
  const {t} = useTranslation('recommendations');
  const q = useRecommendation(id);
  if (!id)
    return (
      <Card className="flex items-center justify-center p-6">
        <EmptyState title={t('detail.select')} />
      </Card>
    );
  if (q.isLoading)
    return (
      <Card className="flex flex-col gap-3 p-5">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20" />
        <Skeleton className="h-32" />
      </Card>
    );
  if (q.error || !q.data)
    return (
      <Card className="p-5">
        <ErrorView
          traceId={errorTraceId(q.error)}
          title={
            isApiError(q.error, 'NOT_FOUND')
              ? t('detail.notFound')
              : errorMessage(q.error, t)
          }
          onRetry={
            isApiError(q.error, 'NOT_FOUND')
              ? undefined
              : () => void q.refetch()
          }
        />
        <Link to="/recommendations" className="text-sm text-cyan">
          {t('title')}
        </Link>
      </Card>
    );
  return <RecommendationDetail rec={q.data} />;
}

/** Recommendation center page. */
export function RecommendationsPage() {
  const {t} = useTranslation('recommendations');
  const params = useParams({strict: false}) as {id?: string};
  const {pathname} = useLocation();
  const id = routeId(params, pathname, 'recommendations');
  const search = useLooseSearch();
  const patch = useSearchPatch();
  const tab = toRecTab(searchString(search, 'tab'));

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        breadcrumb={t('title')}
        title={tab === 'pending' ? t('pendingTitle') : t('title')}
        description={t('description')}
        actions={
          <Tabs
            value={tab}
            onValueChange={v => patch({tab: v === 'pending' ? undefined : v})}
          >
            <TabsList aria-label={t('tabs.aria')}>
              {REC_TABS.map(k => (
                <TabsTrigger key={k} value={k}>
                  {t(`tabs.${k}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(280px,2fr)_minmax(0,5fr)]">
        <Card className="min-w-0 self-start">
          <RecList tab={tab} selectedId={id} />
        </Card>
        <DetailPane id={id} />
      </div>
    </div>
  );
}
