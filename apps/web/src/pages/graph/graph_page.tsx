/**
 * @fileoverview 关系探索 (/graph?rid=&depth=&linkTypes=): expand 1–2 hops
 * from any object, filter by link type, recentre on a node or open its
 * Object View. The server returns ≤ 300 nodes (D1 recursive CTE).
 */

import type {GraphNode} from '@ontodecide/object-graph/contract';
import {useNavigate} from '@tanstack/react-router';
import {Crosshair, ExternalLink, Network} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ObjectRefInput} from '../../entities/renderers/object_ref_input';
import {useUiModel} from '../../entities/schema/api';
import {useLinks} from '../../features/object-graph/api';
import {LinkGraph} from '../../features/object-graph/components/link_graph';
import {
  searchString,
  useLooseSearch,
  useSearchPatch,
} from '../../features/object-graph/search_params';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Checkbox, Label} from '../../shared/ui/input';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Tabs, TabsList, TabsTrigger} from '../../shared/ui/tabs';

/** Graph exploration page. */
export function GraphPage() {
  const {t} = useTranslation('objects');
  const navigate = useNavigate();
  const search = useLooseSearch();
  const patch = useSearchPatch();
  const {model} = useUiModel();
  const rid = searchString(search, 'rid');
  const depth = searchString(search, 'depth') === '1' ? 1 : 2;
  const linkTypes = useMemo(
    () => (searchString(search, 'linkTypes') ?? '').split(',').filter(Boolean),
    [search],
  );
  const links = useLinks(rid, depth, linkTypes);
  const [selected, setSelected] = useState<string>();
  const node: GraphNode | undefined = links.data?.nodes.find(
    n => n.rid === (selected ?? rid),
  );

  const toggleType = (lt: string, on: boolean) => {
    const next = on ? [...linkTypes, lt] : linkTypes.filter(x => x !== lt);
    patch({linkTypes: next.join(',') || undefined});
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={t('graphPage.breadcrumb')}
        title={t('graphPage.title')}
        description={t('graphPage.description')}
      />
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title={t('graphPage.controls')}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="graph-start">{t('graphPage.start')}</Label>
              <ObjectRefInput
                id="graph-start"
                value={rid ?? ''}
                label={t('graphPage.start')}
                onChange={v => {
                  setSelected(undefined);
                  patch({rid: v || undefined});
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">
                {t('graphPage.depth')}
              </span>
              <Tabs
                value={String(depth)}
                onValueChange={v => patch({depth: v})}
              >
                <TabsList aria-label={t('graphPage.depth')}>
                  <TabsTrigger value="1">
                    {t('graphPage.hops', {n: 1})}
                  </TabsTrigger>
                  <TabsTrigger value="2">
                    {t('graphPage.hops', {n: 2})}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-medium text-muted">
                {t('graphPage.linkTypes')}
              </legend>
              {model.links.map(l => {
                const id = `lt-${l.apiName}`;
                return (
                  <div
                    key={l.apiName}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={linkTypes.includes(l.apiName)}
                      onCheckedChange={c => toggleType(l.apiName, c === true)}
                    />
                    <label htmlFor={id} className="cursor-pointer">
                      {l.displayName}{' '}
                      <span className="text-xs text-dim">
                        {model.byName[l.from]?.displayName ?? l.from} →{' '}
                        {model.byName[l.to]?.displayName ?? l.to}
                      </span>
                    </label>
                  </div>
                );
              })}
              <p className="text-xs text-dim">{t('graphPage.allTypesHint')}</p>
            </fieldset>
            {node && (
              <div className="rounded-[10px] border border-line-2 bg-panel-2 p-3">
                <p className="text-sm font-medium text-text">{node.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone="blue">
                    {model.byName[node.type]?.displayName ?? node.type}
                  </Badge>
                  <span className="text-xs text-muted">
                    {t('graphPage.hop', {n: node.hop})}
                  </span>
                </div>
                <Mono className="mt-1 block break-all">{node.rid}</Mono>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void navigate({
                        to: '/objects/$rid',
                        params: {rid: node.rid},
                      })
                    }
                  >
                    <ExternalLink aria-hidden />
                    {t('graphPage.open')}
                  </Button>
                  {node.rid !== rid && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelected(undefined);
                        patch({rid: node.rid});
                      }}
                    >
                      <Crosshair aria-hidden />
                      {t('graphPage.recenter')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Panel>
        <Panel
          title={t('graphPage.graph')}
          actions={
            links.data && (
              <span className="text-xs text-muted">
                {t('graphPage.meta', {
                  hops: depth,
                  nodes: links.data.nodes.length,
                  edges: links.data.edges.length,
                })}
              </span>
            )
          }
        >
          {!rid ? (
            <EmptyState
              icon={<Network aria-hidden />}
              title={t('graphPage.pickStart')}
            />
          ) : links.error ? (
            <ErrorView
              traceId={errorTraceId(links.error)}
              detail={errorMessage(links.error, t)}
              onRetry={() => void links.refetch()}
            />
          ) : links.isLoading ? (
            <Skeleton className="h-[520px] w-full" />
          ) : (
            <LinkGraph
              slice={links.data}
              rootRid={rid}
              height={520}
              onNodeClick={n => setSelected(n.id)}
              onNodeDoubleClick={n =>
                n.id.startsWith('ri.') && patch({rid: n.id})
              }
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
