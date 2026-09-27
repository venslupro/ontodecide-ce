/**
 * @fileoverview 对象详情 (/objects/$rid): one template for every object
 * type, laid out from the ontology — header (title, type, risk
 * properties, RID · version, 「发起推演」, 「执行动作」 menu with only the
 * actions whose preconditions hold), properties with lineage and inline
 * merge-patch edit, 2-hop relationship graph, timeline (imports, actions,
 * alerts, recommendations) and related alerts / recommendations.
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import type {RecommendationDto} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Link, useNavigate, useParams} from '@tanstack/react-router';
import {useQueryClient} from '@tanstack/react-query';
import {ChevronDown, ExternalLink, FlaskConical, Zap} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getRenderer} from '../../entities/renderers/registry';
import {useUiModel} from '../../entities/schema/api';
import {riskProperties, type UiActionType} from '../../entities/schema/model';
import {useRecommendations} from '../../features/decision/api';
import {ConfirmRecommendationDialog} from '../../features/decision/components/confirm_dialog';
import {
  fetchObject,
  objectKeys,
  useActionLog,
  useLinks,
  useObject,
} from '../../features/object-graph/api';
import {ActionDialog} from '../../features/object-graph/components/action_dialog';
import {ConflictDialog} from '../../features/object-graph/components/conflict_dialog';
import {LinkGraph} from '../../features/object-graph/components/link_graph';
import {ObjectTimeline} from '../../features/object-graph/components/object_timeline';
import {PropertyTable} from '../../features/object-graph/components/property_table';
import {TypeIcon} from '../../features/object-graph/components/type_icon';
import {
  availableActions,
  buildTimeline,
} from '../../features/object-graph/model';
import {
  searchString,
  useLooseSearch,
} from '../../features/object-graph/search_params';
import {useAckAlert, useAlerts} from '../../features/situation/api';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {Badge, SeverityBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown_menu';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Mono} from '../../shared/ui/page_header';
import {PageLoader} from '../../shared/ui/skeleton';

function relatesTo(r: RecommendationDto, rid: string): boolean {
  return r.focus === rid || r.candidates.some(c => c.target === rid);
}

/** Object View page. */
export function ObjectViewPage() {
  const {t, i18n} = useTranslation('objects');
  const params = useParams({strict: false}) as {rid?: string; _splat?: string};
  // `_splat`: rendered under a catch-all route (tests, embedding).
  const rid = params.rid ?? params._splat?.split('/').pop() ?? '';
  const navigate = useNavigate();
  const search = useLooseSearch();
  const qc = useQueryClient();
  const {model} = useUiModel();
  const obj = useObject(rid);
  const type = obj.data ? model.byName[obj.data.type] : undefined;
  const links = useLinks(rid, 2);
  const log = useActionLog(rid);
  const alerts = useAlerts({rid: rid as ObjectDto['rid']}, 50, !!rid);
  const recs = useRecommendations();
  const ack = useAckAlert();

  const [action, setAction] = useState<UiActionType>();
  const [conflict, setConflict] = useState<{
    mine?: Record<string, unknown>;
  } | null>(null);
  const [confirmRec, setConfirmRec] = useState<RecommendationDto>();

  const alertList = useMemo(
    () => alerts.data?.pages.flatMap(p => p.items) ?? [],
    [alerts.data],
  );
  const recList = useMemo(
    () =>
      (recs.data?.pages.flatMap(p => p.items) ?? []).filter(r =>
        relatesTo(r, rid),
      ),
    [recs.data, rid],
  );
  const timeline = useMemo(
    () =>
      buildTimeline({
        object: obj.data,
        actions: log.data?.items,
        alerts: alertList,
        recommendations: recList,
      }),
    [obj.data, log.data, alertList, recList],
  );
  const actions = availableActions(type, obj.data);

  if (obj.isLoading) return <PageLoader />;
  if (isApiError(obj.error, 'NOT_FOUND'))
    return (
      <EmptyState
        title={t('view.notFound')}
        description={<Mono>{rid}</Mono>}
        action={
          <Button onClick={() => void navigate({to: '/objects'})}>
            {t('view.back')}
          </Button>
        }
      />
    );
  if (obj.error || !obj.data)
    return (
      <ErrorView
        detail={errorMessage(obj.error, t)}
        onRetry={() => void obj.refetch()}
      />
    );

  const o = obj.data;
  const refresh = () =>
    void qc.invalidateQueries({queryKey: objectKeys.one(rid)});

  return (
    <div className="flex flex-col gap-4">
      <header className="glass flex flex-wrap items-center gap-4 p-5">
        <div className="flex size-14 items-center justify-center rounded-[12px] border border-cyan/40 bg-cyan/10 text-cyan">
          <TypeIcon icon={type?.icon} className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <nav aria-label="breadcrumb" className="text-xs text-dim">
            <Link
              to="/objects"
              search={{type: o.type} as never}
              className="hover:text-text"
            >
              {t('list.title')}
            </Link>{' '}
            / {type?.displayName ?? o.type}
          </nav>
          <h1 className="mt-0.5 truncate text-xl font-semibold text-text">
            {o.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="blue">{type?.displayName ?? o.type}</Badge>
            {type &&
              riskProperties(type).map(p => (
                <Badge key={p.apiName} tone="crit">
                  {p.displayName}{' '}
                  {getRenderer(p.dataType).text(o.props[p.apiName], p)}
                </Badge>
              ))}
            <Mono>
              {o.rid} · v{o.version}
            </Mono>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              void navigate({to: '/scenarios', search: {rid: o.rid} as never})
            }
          >
            <FlaskConical aria-hidden />
            {t('view.simulate')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="primary" disabled={!type}>
                <Zap aria-hidden />
                {t('view.execute')}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.length === 0 && (
                <DropdownMenuItem disabled>
                  {t('view.noActions')}
                </DropdownMenuItem>
              )}
              {actions.map(a => (
                <DropdownMenuItem key={a.apiName} onSelect={() => setAction(a)}>
                  {a.displayName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel title={t('props.title')} subtitle={t('props.hoverHint')}>
          {type ? (
            <PropertyTable
              type={type}
              object={o}
              onConflict={mine => setConflict({mine})}
              focusProp={searchString(search, 'prop')}
            />
          ) : (
            <p className="text-sm text-dim">{t('view.unknownType')}</p>
          )}
        </Panel>
        <Panel
          title={t('view.links')}
          actions={
            <>
              <span className="text-xs text-muted">
                {t('view.linksMeta', {count: links.data?.nodes.length ?? 0})}
              </span>
              <Link
                to="/graph"
                search={{rid: o.rid} as never}
                className="inline-flex items-center gap-1 text-xs text-cyan hover:underline"
              >
                {t('view.openInGraph')}
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            </>
          }
        >
          {links.error ? (
            <ErrorView detail={errorMessage(links.error, t)} />
          ) : (
            <LinkGraph
              slice={links.data}
              rootRid={o.rid}
              onNodeDoubleClick={n =>
                n.id.startsWith('ri.') &&
                void navigate({to: '/objects/$rid', params: {rid: n.id}})
              }
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel title={t('timeline.title')}>
          <ObjectTimeline entries={timeline} />
        </Panel>
        <Panel title={t('view.related')}>
          <ul className="flex flex-col">
            {alertList.length === 0 && recList.length === 0 && (
              <li className="py-2 text-sm text-dim">{t('view.noRelated')}</li>
            )}
            {alertList.map(a => (
              <li
                key={a.id}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <SeverityBadge severity={a.severity} />
                <span
                  className="min-w-0 flex-1 truncate text-sm"
                  title={resolveText(a.automationName, i18n.language)}
                >
                  {a.title}
                </span>
                {a.status === 'OPEN' ? (
                  <Button
                    size="sm"
                    loading={ack.isPending && ack.variables === a.id}
                    onClick={() => ack.mutate(a.id)}
                  >
                    {t('view.ack')}
                  </Button>
                ) : (
                  <Badge>{t(`view.alertStatus.${a.status}`)}</Badge>
                )}
              </li>
            ))}
            {recList.map(r => (
              <li
                key={r.id}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <Badge tone="cyan">{t('view.recBadge')}</Badge>
                <Link
                  to="/recommendations/$id"
                  params={{id: r.id}}
                  className="min-w-0 flex-1 truncate text-sm hover:text-cyan"
                >
                  {r.summary}
                </Link>
                {r.status === 'Proposed' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setConfirmRec(r)}
                  >
                    {t('view.confirm')}
                  </Button>
                ) : (
                  <Badge>{t(`view.recStatus.${r.status}`)}</Badge>
                )}
              </li>
            ))}
          </ul>
          {ack.error ? (
            <p role="alert" className="mt-2 text-xs text-crit">
              {errorMessage(ack.error, t)}
            </p>
          ) : null}
        </Panel>
      </div>

      <ActionDialog
        action={action}
        object={o}
        open={!!action}
        onOpenChange={open => !open && setAction(undefined)}
        onConflict={() => setConflict({})}
      />
      <ConflictDialog
        open={!!conflict}
        onOpenChange={open => !open && setConflict(null)}
        mine={conflict?.mine}
        loadTheirs={async () => (await fetchObject(rid)).props}
        onRefresh={refresh}
      />
      {confirmRec && (
        <ConfirmRecommendationDialog
          recommendation={confirmRec}
          open={!!confirmRec}
          onOpenChange={open => !open && setConfirmRec(undefined)}
          onDone={() => setConfirmRec(undefined)}
        />
      )}
    </div>
  );
}
