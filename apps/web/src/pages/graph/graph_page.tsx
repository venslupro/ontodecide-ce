/**
 * @fileoverview Relation explorer (/graph): start from any object and run
 * Search Around (depth 1/2, double-click to expand), shortest paths to a
 * second object, or the impact subgraph (1–3 hops). Link-type filter, node
 * limit, type legend and a side panel for the selected node; `rid` / `to` /
 * `mode` are synced to the URL.
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {
  ArrowRight,
  Crosshair,
  Flame,
  Network,
  Route,
  Waypoints,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {GraphSearch} from '../../app/router';
import {ObjectRefInput} from '../../entities/renderers/object_ref_input';
import {getRenderer} from '../../entities/renderers/registry';
import {useUiModel} from '../../entities/schema/api';
import {orderedProperties} from '../../entities/schema/model';
import {
  objectQuery,
  useImpact,
  useObject,
  useObjectSummaries,
  usePaths,
} from '../../features/object-graph/api';
import {GraphLegend} from '../../features/object-graph/components/graph_parts';
import {TypeDot} from '../../features/object-graph/components/type_icon';
import {
  EMPTY_GRAPH,
  filterByLinkTypes,
  impactToGraph,
  linkLabels,
  mergeGraphs,
  objectToGraph,
  pathsToGraph,
  shortRid,
  type GraphData,
} from '../../features/object-graph/model';
import {errorMessage} from '../../shared/api/error_message';
import {GraphView} from '../../shared/graph/graph_view';
import {
  GRAPH_NODE_DEFAULT,
  GRAPH_NODE_MAX,
  type GNode,
} from '../../shared/graph/limit';
import {cn} from '../../shared/lib/cn';
import {track} from '../../shared/lib/telemetry';
import {DegradedBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card, Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Checkbox, Label} from '../../shared/ui/input';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {NativeSelect} from '../../shared/ui/select';
import {Spinner} from '../../shared/ui/skeleton';
import {Tabs, TabsList, TabsTrigger} from '../../shared/ui/tabs';
import {toast} from '../../shared/ui/toast';

type Mode = NonNullable<GraphSearch['mode']>;

/** /graph — relation explorer. */
export function GraphPage() {
  const {t} = useTranslation('objects');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({strict: false}) as GraphSearch;
  const mode: Mode = search.mode ?? 'around';
  const rid = search.rid || undefined;
  const to = search.to || undefined;
  const {model} = useUiModel();

  const [depth, setDepth] = useState<1 | 2>(2);
  const [hops, setHops] = useState<1 | 2 | 3>(2);
  const [limit, setLimit] = useState<number>(GRAPH_NODE_DEFAULT);
  const [linkTypes, setLinkTypes] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [pathIdx, setPathIdx] = useState(0);
  const [expanded, setExpanded] = useState<ObjectDto[]>([]);
  const [expanding, setExpanding] = useState(false);

  useEffect(() => track('page_view:graph'), []);
  useEffect(() => {
    setExpanded([]);
    setSelected(undefined);
    setPathIdx(0);
  }, [rid, to, mode]);

  const setSearch = (patch: Partial<GraphSearch>) =>
    void navigate({
      to: '/graph',
      search: (() => {
        const next: GraphSearch = {
          rid: search.rid,
          to: search.to,
          mode: search.mode,
          ...patch,
        };
        for (const k of Object.keys(next) as (keyof GraphSearch)[])
          if (!next[k]) delete next[k];
        return next;
      })(),
    });

  const labels = useMemo(() => linkLabels(model.links), [model.links]);
  const typeOrder = useMemo(
    () => model.types.map(x => x.apiName),
    [model.types],
  );

  // --- data per mode ----------------------------------------------------------
  const around = useObject(mode === 'around' ? rid : undefined, depth);
  const paths = usePaths(
    mode === 'paths' ? rid : undefined,
    mode === 'paths' ? to : undefined,
  );
  const impact = useImpact(
    mode === 'impact' ? rid : undefined,
    hops,
    linkTypes,
    limit,
  );

  const pathRids = useMemo(
    () =>
      [
        ...new Set([...(paths.data?.paths.flat() ?? []), rid ?? '', to ?? '']),
      ].filter(Boolean),
    [paths.data, rid, to],
  );
  const summaries = useObjectSummaries(
    mode === 'paths'
      ? pathRids
      : selected
        ? [selected, ...(rid ? [rid] : [])]
        : rid
          ? [rid]
          : [],
  );
  const titles = useMemo(
    () =>
      Object.fromEntries(
        Object.values(summaries.byRid).map(o => [o.rid, o.title]),
      ),
    [summaries.byRid],
  );

  const graph: GraphData = useMemo(() => {
    if (!rid) return EMPTY_GRAPH;
    if (mode === 'around') {
      if (!around.data) return EMPTY_GRAPH;
      const merged = mergeGraphs(
        objectToGraph(around.data, labels),
        ...expanded.map(o => objectToGraph(o, labels)),
      );
      return filterByLinkTypes(merged, linkTypes);
    }
    if (mode === 'paths')
      return paths.data
        ? pathsToGraph(paths.data.paths, titles, pathIdx)
        : EMPTY_GRAPH;
    return impact.data
      ? impactToGraph(impact.data, rid, hops, labels)
      : EMPTY_GRAPH;
  }, [
    rid,
    mode,
    around.data,
    expanded,
    labels,
    linkTypes,
    paths.data,
    titles,
    pathIdx,
    impact.data,
    hops,
  ]);

  const active = mode === 'around' ? around : mode === 'paths' ? paths : impact;
  const loading = !!rid && active.isLoading && (mode !== 'paths' || !!to);
  const degraded =
    mode === 'paths'
      ? !!paths.data?.degraded
      : mode === 'impact'
        ? !!impact.data?.degraded
        : false;

  const expand = async (n: GNode) => {
    if (
      mode !== 'around' ||
      n.hidden ||
      n.root ||
      expanded.some(o => o.rid === n.id)
    )
      return;
    setExpanding(true);
    try {
      const o = await qc.fetchQuery(objectQuery(n.id, 1));
      setExpanded(prev => [...prev, o]);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setExpanding(false);
    }
  };

  const startTitle = rid ? (titles[rid] ?? around.data?.title) : undefined;

  return (
    <div className="fade-in flex flex-col gap-3.5">
      <PageHeader
        title={t('graph.title')}
        description={t('graph.description')}
      />

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="graph-start">{t('graph.start')}</Label>
            <ObjectRefInput
              id="graph-start"
              value={rid ?? ''}
              label={t('graph.start')}
              onChange={v => setSearch({rid: v || undefined})}
            />
            {startTitle && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Crosshair className="size-3 text-cyan" aria-hidden />
                {startTitle}
                <Mono className="text-[10px] text-dim">{shortRid(rid!)}</Mono>
              </span>
            )}
          </div>
          {mode === 'paths' && (
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <Label htmlFor="graph-to">{t('graph.to')}</Label>
              <ObjectRefInput
                id="graph-to"
                value={to ?? ''}
                label={t('graph.to')}
                onChange={v => setSearch({to: v || undefined})}
              />
              {to && titles[to] && (
                <span className="text-xs text-muted">{titles[to]}</span>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">
              {t('graph.mode')}
            </span>
            <Tabs
              value={mode}
              onValueChange={v =>
                setSearch({mode: v === 'around' ? undefined : (v as Mode)})
              }
            >
              <TabsList aria-label={t('graph.mode')}>
                <TabsTrigger value="around">
                  <Waypoints aria-hidden />
                  {t('graph.modes.around')}
                </TabsTrigger>
                <TabsTrigger value="paths">
                  <Route aria-hidden />
                  {t('graph.modes.paths')}
                </TabsTrigger>
                <TabsTrigger value="impact">
                  <Flame aria-hidden />
                  {t('graph.modes.impact')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {mode === 'around' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="graph-depth">{t('graph.depth')}</Label>
              <NativeSelect
                id="graph-depth"
                className="w-28"
                value={String(depth)}
                onChange={e => setDepth(e.target.value === '1' ? 1 : 2)}
                options={[
                  {value: '1', label: t('graph.hopsN', {n: 1})},
                  {value: '2', label: t('graph.hopsN', {n: 2})},
                ]}
              />
            </div>
          )}
          {mode === 'impact' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="graph-hops">{t('graph.hops')}</Label>
              <NativeSelect
                id="graph-hops"
                className="w-28"
                value={String(hops)}
                onChange={e => setHops(Number(e.target.value) as 1 | 2 | 3)}
                options={[1, 2, 3].map(n => ({
                  value: String(n),
                  label: t('graph.hopsN', {n}),
                }))}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="graph-limit">{t('graph.limit')}</Label>
            <NativeSelect
              id="graph-limit"
              className="w-28"
              value={String(limit)}
              onChange={e => setLimit(Number(e.target.value))}
              options={[GRAPH_NODE_DEFAULT, GRAPH_NODE_MAX].map(n => ({
                value: String(n),
                label: t('graph.nodesN', {n}),
              }))}
            />
          </div>
        </div>

        {model.links.length > 0 && mode !== 'paths' && (
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <legend className="mb-1 text-xs font-medium text-muted">
              {t('graph.linkTypes')}
            </legend>
            {model.links.map(l => {
              const id = `lt-${l.apiName}`;
              const checked =
                linkTypes.length === 0 || linkTypes.includes(l.apiName);
              return (
                <div key={l.apiName} className="flex items-center gap-1.5">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={c => {
                      const all = model.links.map(x => x.apiName);
                      const cur = linkTypes.length === 0 ? all : linkTypes;
                      const next =
                        c === true
                          ? [...new Set([...cur, l.apiName])]
                          : cur.filter(x => x !== l.apiName);
                      setLinkTypes(next.length === all.length ? [] : next);
                    }}
                  />
                  <Label htmlFor={id} className="text-sm text-text">
                    {l.displayName}
                  </Label>
                </div>
              );
            })}
          </fieldset>
        )}
      </Card>

      <div className="grid grid-cols-12 gap-3.5">
        <Panel
          className="col-span-12 lg:col-span-8 xl:col-span-9"
          title={t(`graph.modes.${mode}`)}
          icon={<Network aria-hidden />}
          subtitle={
            mode === 'around'
              ? t('graph.aroundHint')
              : mode === 'paths'
                ? t('graph.pathsHint')
                : t('graph.impactHint')
          }
          actions={
            <span className="flex items-center gap-2">
              {(expanding || (active.isFetching && !loading)) && <Spinner />}
              {degraded && (
                <>
                  <DegradedBadge
                    reason={
                      mode === 'impact'
                        ? t('graph.impactDegraded')
                        : t('graph.pathsDegraded')
                    }
                  />
                  <span className="text-xs text-warn">
                    {mode === 'impact'
                      ? t('graph.impactDegraded')
                      : t('graph.pathsDegraded')}
                  </span>
                </>
              )}
              {graph.nodes.length > 0 && (
                <span className="num text-xs text-dim">
                  {t('graph.counts', {
                    nodes: graph.nodes.length,
                    edges: graph.edges.length,
                  })}
                </span>
              )}
            </span>
          }
        >
          {!rid ? (
            <EmptyState
              icon={<Crosshair aria-hidden />}
              title={t('graph.pickStart')}
              description={t('graph.pickStartHint')}
              className="min-h-[420px]"
            />
          ) : mode === 'paths' && !to ? (
            <EmptyState
              icon={<Route aria-hidden />}
              title={t('graph.pickTo')}
              className="min-h-[420px]"
            />
          ) : loading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <Spinner />
            </div>
          ) : active.error ? (
            <ErrorView
              detail={errorMessage(active.error, t)}
              onRetry={() => void active.refetch()}
              className="min-h-[420px]"
            />
          ) : graph.nodes.length === 0 ||
            (mode === 'paths' && (paths.data?.paths.length ?? 0) === 0) ? (
            <EmptyState
              title={mode === 'paths' ? t('graph.noPaths') : t('graph.empty')}
              className="min-h-[420px]"
            />
          ) : (
            <>
              <GraphView
                nodes={graph.nodes}
                edges={graph.edges}
                mode={mode === 'around' ? 'type' : 'impact'}
                maxNodes={limit}
                typeOrder={typeOrder}
                height={520}
                selectedId={selected}
                onNodeClick={n => !n.hidden && setSelected(n.id)}
                onNodeDoubleClick={n => void expand(n)}
                ariaLabel={t('graph.ariaLabel', {
                  mode: t(`graph.modes.${mode}`),
                  nodes: graph.nodes.length,
                })}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <GraphLegend nodes={graph.nodes} model={model} />
                {mode === 'impact' && (
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {t('graph.impactScale')}
                    <span
                      aria-hidden
                      className="h-2 w-20 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--orange)_20%,transparent),var(--orange))]"
                    />
                  </span>
                )}
              </div>
            </>
          )}
        </Panel>

        <div className="col-span-12 flex flex-col gap-3.5 lg:col-span-4 xl:col-span-3">
          <SelectedPanel
            id={selected}
            node={graph.nodes.find(n => n.id === selected)}
            object={selected ? summaries.byRid[selected] : undefined}
            onRecenter={id => setSearch({rid: id})}
          />
          {mode === 'paths' && paths.data && paths.data.paths.length > 0 && (
            <Panel
              title={t('graph.pathList')}
              icon={<Route aria-hidden />}
              actions={
                <span className="num text-xs text-dim">
                  {paths.data.paths.length}
                </span>
              }
            >
              <ol className="flex flex-col gap-2">
                {paths.data.paths.map((p, i) => (
                  <li key={p.join('>')}>
                    <button
                      type="button"
                      aria-pressed={i === pathIdx}
                      onClick={() => setPathIdx(i)}
                      className={cn(
                        'w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                        i === pathIdx
                          ? 'border-orange/60 bg-orange/10'
                          : 'border-line hover:bg-panel-2',
                      )}
                    >
                      <span className="mb-1 block font-medium text-muted">
                        {t('graph.pathN', {n: i + 1, hops: p.length - 1})}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        {p.map((r, j) => (
                          <span
                            key={`${r}-${j}`}
                            className="inline-flex items-center gap-1"
                          >
                            {j > 0 && (
                              <ArrowRight
                                className="size-3 text-dim"
                                aria-hidden
                              />
                            )}
                            <span className="text-text">
                              {titles[r] ?? shortRid(r)}
                            </span>
                          </span>
                        ))}
                      </span>
                      <Mono className="mt-1 block text-[10px] break-all text-dim">
                        {p.join(' → ')}
                      </Mono>
                    </button>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectedPanel({
  id,
  node,
  object,
  onRecenter,
}: {
  id?: string;
  node?: GNode;
  object?: ObjectDto;
  onRecenter(rid: string): void;
}) {
  const {t} = useTranslation('objects');
  const {model} = useUiModel();
  const order = model.types.map(x => x.apiName);
  if (!id) {
    return (
      <Panel title={t('graph.selected')} icon={<Crosshair aria-hidden />}>
        <p className="text-xs text-dim">{t('graph.selectHint')}</p>
      </Panel>
    );
  }
  const typeName = object?.type ?? node?.type ?? '';
  const type = model.byName[typeName];
  const props = type
    ? orderedProperties(type)
        .filter(
          p => p.visible && !(object?.hiddenProps ?? []).includes(p.apiName),
        )
        .slice(0, 6)
    : [];
  return (
    <Panel title={t('graph.selected')} icon={<Crosshair aria-hidden />}>
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-semibold break-words text-text">
            {object?.title ?? node?.label ?? id}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <TypeDot type={typeName} order={order} />
            {type?.displayName ?? typeName}
          </p>
          <Mono className="mt-1 block text-[10px] break-all text-dim">
            {id}
          </Mono>
        </div>
        {object && props.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {props.map(p => (
              <div key={p.apiName} className="contents">
                <dt className="text-dim">{p.displayName}</dt>
                <dd className="min-w-0 truncate text-text">
                  {getRenderer(p.dataType).cell(object.props[p.apiName], p)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="secondary">
            <Link to="/objects/rid/$rid" params={{rid: id}}>
              {t('graph.openObject')}
            </Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRecenter(id)}>
            <Crosshair aria-hidden />
            {t('graph.recenter')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
