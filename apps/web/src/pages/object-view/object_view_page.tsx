/**
 * @fileoverview Object View (/objects/rid/$rid): the generic, schema-driven
 * detail template shared by every object type — title area with risk
 * badges, RID and versions; action menu (Operator+); property table with
 * provenance and lineage; 2-hop relation subgraph; unified timeline; related
 * alerts and recommendations.
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useParams} from '@tanstack/react-router';
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronDown,
  Copy,
  History,
  Lightbulb,
  ListTree,
  Network,
  SearchX,
  Zap,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getRenderer} from '../../entities/renderers/registry';
import {useUiModel} from '../../entities/schema/api';
import {
  riskProperties,
  type UiActionType,
  type UiModel,
  type UiObjectType,
} from '../../entities/schema/model';
import {useHasRole} from '../../entities/session/store';
import {useRecommendations} from '../../features/decision/api';
import {useActionLog, useObject} from '../../features/object-graph/api';
import {ActionDialog} from '../../features/object-graph/components/action_form';
import {
  GraphLegend,
  NeighborList,
} from '../../features/object-graph/components/graph_parts';
import {ObjectTimeline} from '../../features/object-graph/components/object_timeline';
import {PropertyTable} from '../../features/object-graph/components/property_table';
import {TypeIcon} from '../../features/object-graph/components/type_icon';
import {
  buildTimeline,
  groupNeighbors,
  linkLabels,
  objectToGraph,
  riskLevel,
} from '../../features/object-graph/model';
import {useAlerts, useUpdateAlert} from '../../features/situation/api';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {qk} from '../../shared/api/query_keys';
import {GraphView} from '../../shared/graph/graph_view';
import {fmt} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
import {track} from '../../shared/lib/telemetry';
import {Badge, SeverityBadge, StatusBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card, Panel} from '../../shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown_menu';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Mono} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {toast} from '../../shared/ui/toast';

/** /objects/rid/$rid — Object View. */
export function ObjectViewPage() {
  const {t} = useTranslation('objects');
  const {rid} = useParams({strict: false}) as {rid?: string};
  const obj = useObject(rid, 2);
  const {model, isLoading: modelLoading} = useUiModel();

  const objType = obj.data?.type;
  useEffect(() => {
    if (objType) track('page_view:object_view', objType);
  }, [objType]);

  if (obj.isLoading || modelLoading) return <ObjectViewSkeleton />;
  if (obj.error) {
    if (isApiError(obj.error, 'OBJECT_NOT_FOUND', 'NOT_FOUND')) {
      return (
        <Card>
          <EmptyState
            icon={<SearchX aria-hidden />}
            title={t('view.notFound')}
            description={t('view.notFoundHint', {rid: rid ?? ''})}
            action={
              <Button asChild variant="secondary">
                <Link to="/objects">
                  <ArrowLeft aria-hidden />
                  {t('list.backToTypes')}
                </Link>
              </Button>
            }
          />
        </Card>
      );
    }
    return (
      <Card>
        <ErrorView
          detail={errorMessage(obj.error, t)}
          onRetry={() => void obj.refetch()}
        />
      </Card>
    );
  }
  if (!obj.data) return null;
  const type = model.byName[obj.data.type];
  if (!type) {
    return (
      <Card>
        <EmptyState
          title={t('list.unknownType', {type: obj.data.type})}
          description={t('list.unknownTypeHint')}
        />
      </Card>
    );
  }
  return (
    <ObjectView
      object={obj.data}
      type={type}
      model={model}
      refetch={async () => (await obj.refetch()).data?.version}
    />
  );
}

function ObjectViewSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-busy>
      <Card className="flex flex-col gap-2 p-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-96" />
      </Card>
      <div className="grid grid-cols-12 gap-3.5">
        <Skeleton className="col-span-12 h-80 lg:col-span-7" />
        <Skeleton className="col-span-12 h-80 lg:col-span-5" />
      </div>
    </div>
  );
}

function ObjectView({
  object,
  type,
  model,
  refetch,
}: {
  object: ObjectDto;
  type: UiObjectType;
  model: UiModel;
  refetch(): Promise<number | undefined>;
}) {
  const {t, i18n} = useTranslation('objects');
  const qc = useQueryClient();
  const canAct = useHasRole('Operator');
  const online = useOnline();
  const [action, setAction] = useState<UiActionType | null>(null);

  const actionLog = useActionLog(object.rid);
  const alerts = useAlerts({rid: object.rid});
  const recs = useRecommendations({focus: object.rid});
  const focusedRecs = useMemo(
    () => (recs.data ?? []).filter(r => r.focus === object.rid),
    [recs.data, object.rid],
  );
  const objectAlerts = useMemo(
    () => (alerts.data ?? []).filter(a => a.rid === object.rid),
    [alerts.data, object.rid],
  );

  const labels = useMemo(() => linkLabels(model.links), [model.links]);
  const graph = useMemo(() => objectToGraph(object, labels), [object, labels]);
  const groups = useMemo(() => groupNeighbors(object), [object]);
  const typeOrder = useMemo(
    () => model.types.map(x => x.apiName),
    [model.types],
  );
  const timeline = useMemo(
    () =>
      buildTimeline({
        object,
        actions: actionLog.data,
        alerts: objectAlerts,
        recommendations: focusedRecs,
      }),
    [object, actionLog.data, objectAlerts, focusedRecs],
  );

  const risks = riskProperties(type).filter(
    p => p.visible && !(object.hiddenProps ?? []).includes(p.apiName),
  );

  return (
    <div className="fade-in flex flex-col gap-3.5">
      {/* Title area */}
      <Card className="p-4">
        <nav
          aria-label="breadcrumb"
          className="mb-1 flex flex-wrap items-center gap-1 text-xs text-dim"
        >
          <Link to="/objects" className="hover:text-cyan">
            {t('index.title')}
          </Link>
          <span aria-hidden>/</span>
          <Link
            to="/objects/$type"
            params={{type: type.apiName}}
            className="hover:text-cyan"
          >
            {type.displayName}
          </Link>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan/30 bg-cyan/10 text-cyan">
                <TypeIcon icon={type.icon} className="size-5" />
              </span>
              <h1 className="text-xl font-semibold tracking-tight break-words text-text">
                {object.title}
              </h1>
              <Badge tone="cyan">{type.displayName}</Badge>
              {risks.map(p => {
                const v = object.props[p.apiName];
                const level = riskLevel(v);
                if (!level) return null;
                return (
                  <StatusBadge key={p.apiName} level={level}>
                    {p.displayName} {getRenderer(p.dataType).text(v, p)} ·{' '}
                    {t(`view.risk.${level}`)}
                  </StatusBadge>
                );
              })}
            </div>
            <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <div className="flex items-center gap-1">
                <dt className="text-dim">{t('view.rid')}</dt>
                <dd className="flex items-center gap-1">
                  <Mono>{object.rid}</Mono>
                  <CopyButton value={object.rid} />
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="text-dim">{t('view.version')}</dt>
                <dd className="num text-text">v{object.version}</dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="text-dim">{t('view.updated')}</dt>
                <dd>
                  <time
                    dateTime={object.updatedAt}
                    title={fmt.dateTime(object.updatedAt)}
                  >
                    {fmt.ago(object.updatedAt)}
                  </time>
                </dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="text-dim">{t('view.schemaVersion')}</dt>
                <dd className="num">{object.schemaVersion}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary">
              <Link to="/graph" search={{rid: object.rid}}>
                <Network aria-hidden />
                {t('view.explore')}
              </Link>
            </Button>
            {canAct && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="primary"
                    disabled={!online || type.actions.length === 0}
                    title={!online ? t('action.offline') : undefined}
                  >
                    <Zap aria-hidden />
                    {t('view.runAction')}
                    <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>
                    {t('view.actionsFor', {type: type.displayName})}
                  </DropdownMenuLabel>
                  {type.actions.map(a => (
                    <DropdownMenuItem
                      key={a.apiName}
                      onSelect={() => setAction(a)}
                    >
                      <Zap aria-hidden />
                      <span className="flex-1">{a.displayName}</span>
                      {a.requiresApproval && (
                        <span className="text-[10px] text-violet">
                          {t('view.needsApproval')}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-3.5">
        <Panel
          className="col-span-12 xl:col-span-7"
          title={t('view.properties')}
          icon={<ListTree aria-hidden />}
          subtitle={t('view.propertiesHint')}
          bodyClassName="px-1"
        >
          <PropertyTable type={type} object={object} />
        </Panel>

        <div className="col-span-12 flex min-w-0 flex-col gap-3.5 xl:col-span-5">
          <Panel
            title={t('view.relations')}
            icon={<Network aria-hidden />}
            subtitle={t('view.relationsHint', {count: graph.nodes.length - 1})}
            actions={
              <Link
                to="/graph"
                search={{rid: object.rid}}
                className="text-xs font-medium whitespace-nowrap text-cyan hover:underline"
              >
                {t('view.continueExplore')}
              </Link>
            }
          >
            <GraphView
              nodes={graph.nodes}
              edges={graph.edges}
              mode="type"
              typeOrder={typeOrder}
              height={280}
              selectedId={object.rid}
              ariaLabel={t('view.graphLabel', {
                title: object.title,
                count: graph.nodes.length,
              })}
            />
            <div className="mt-2">
              <GraphLegend nodes={graph.nodes} model={model} />
            </div>
            <details className="mt-3 group" open={groups.length <= 3}>
              <summary className="cursor-pointer text-xs font-medium text-muted select-none hover:text-text">
                {t('view.neighborList')}
              </summary>
              <div className="mt-2">
                <NeighborList groups={groups} model={model} />
              </div>
            </details>
          </Panel>

          <Panel
            title={t('view.relatedAlerts')}
            icon={<Bell aria-hidden />}
            actions={
              <span className="num text-xs text-dim">
                {objectAlerts.length}
              </span>
            }
          >
            {alerts.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : objectAlerts.length === 0 ? (
              <p className="text-xs text-dim">{t('view.noAlerts')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {objectAlerts.map(a => (
                  <AlertRow
                    key={a.id}
                    id={a.id}
                    title={resolveText(
                      a.automationName,
                      i18n.language,
                      a.title,
                    )}
                    detail={a.title}
                    severity={a.severity}
                    status={a.status}
                    raisedAt={a.raisedAt}
                    canAck={canAct && online}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={t('view.relatedRecs')}
            icon={<Lightbulb aria-hidden />}
            actions={
              <span className="num text-xs text-dim">{focusedRecs.length}</span>
            }
          >
            {recs.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : focusedRecs.length === 0 ? (
              <p className="text-xs text-dim">{t('view.noRecs')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {focusedRecs.map(r => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-line bg-panel-2/50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge
                        tone={r.status === 'Proposed' ? 'violet' : 'neutral'}
                      >
                        {t(`common:recStatus.${r.status}`)}
                      </Badge>
                      <span className="text-[11px] text-dim">
                        {t('view.confidence', {value: r.confidence})} ·{' '}
                        {fmt.ago(r.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-text">
                      {r.summary}
                    </p>
                    <Link
                      to="/recommendations/$id"
                      params={{id: r.id}}
                      className="mt-1 inline-block text-xs font-medium text-cyan hover:underline"
                    >
                      {r.status === 'Proposed'
                        ? t('view.goApprove')
                        : t('view.openRec')}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          className="col-span-12"
          title={t('view.timeline')}
          icon={<History aria-hidden />}
        >
          {actionLog.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ObjectTimeline entries={timeline} actions={type.actions} />
          )}
        </Panel>
      </div>

      {action && (
        <ActionDialog
          open={!!action}
          onOpenChange={o => !o && setAction(null)}
          action={action}
          target={{
            rid: object.rid,
            version: object.version,
            title: object.title,
          }}
          onRefreshTarget={refetch}
          onDone={() => {
            void qc.invalidateQueries({queryKey: qk.object(object.rid)});
            void qc.invalidateQueries({queryKey: qk.actionLog(object.rid)});
          }}
        />
      )}
    </div>
  );
}

function AlertRow({
  id,
  title,
  detail,
  severity,
  status,
  raisedAt,
  canAck,
}: {
  id: string;
  title: string;
  detail: string;
  severity: string;
  status: string;
  raisedAt: string;
  canAck: boolean;
}) {
  const {t} = useTranslation('objects');
  const update = useUpdateAlert();
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-panel-2/50 px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={severity} />
          <span className="text-sm font-medium text-text">{title}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">{detail}</p>
        <p className="text-[11px] text-dim">
          {t(`common:alertStatus.${status}`)} ·{' '}
          <time dateTime={raisedAt}>{fmt.ago(raisedAt)}</time>
        </p>
      </div>
      {status === 'OPEN' && canAck && (
        <Button
          size="sm"
          variant="secondary"
          loading={update.isPending}
          onClick={() =>
            update.mutate(
              {id, status: 'ACKED'},
              {
                onSuccess: () => toast.success(t('view.alertAcked')),
                onError: e => toast.error(errorMessage(e, t)),
              },
            )
          }
        >
          <Check aria-hidden />
          {t('view.ack')}
        </Button>
      )}
    </li>
  );
}

function CopyButton({value}: {value: string}) {
  const {t} = useTranslation('objects');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      className="rounded p-0.5 text-dim hover:bg-panel-2 hover:text-cyan"
      aria-label={copied ? t('common:actions.copied') : t('view.copyRid')}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => toast.error(t('common:errors.generic')),
        );
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-good" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
