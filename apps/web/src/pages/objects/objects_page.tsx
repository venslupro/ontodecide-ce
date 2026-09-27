/**
 * @fileoverview 对象浏览 (/objects): objects per ontology type with
 * ontology-driven columns, a filter builder (AND/OR, indexed properties),
 * sort on indexed columns, search by name / primary key / RID (300 ms
 * debounce) and virtualization above 100 rows. State lives in the URL
 * (`?type=&q=&filter=&orderBy=prop:dir`).
 */

import type {FilterExpr} from '@ontodecide/shared-kernel';
import {isRid} from '@ontodecide/shared-kernel';
import {useNavigate} from '@tanstack/react-router';
import {Filter, Search, X} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getRenderer, type RenderProp} from '../../entities/renderers/registry';
import {useUiModel} from '../../entities/schema/api';
import {FilterBuilder} from '../../entities/schema/filter_builder';
import {
  countConditions,
  fromFilterExpr,
  toFilterExpr,
  type FilterGroup,
} from '../../entities/schema/filter_model';
import {useObjects, useObjectStats} from '../../features/object-graph/api';
import {ObjectTable} from '../../features/object-graph/components/object_table';
import {TypeIcon} from '../../features/object-graph/components/type_icon';
import {
  filterParam,
  nextSort,
  parseFilterParam,
  parseOrderBy,
} from '../../features/object-graph/model';
import {
  searchString,
  useLooseSearch,
  useSearchPatch,
} from '../../features/object-graph/search_params';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {useDebouncedValue} from '../../shared/lib/hooks';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Input} from '../../shared/ui/input';
import {PageHeader} from '../../shared/ui/page_header';
import {Popover, PopoverContent, PopoverTrigger} from '../../shared/ui/popover';
import {Skeleton} from '../../shared/ui/skeleton';

function FilterPopover({
  properties,
  value,
  onApply,
}: {
  properties: RenderProp[];
  value: FilterExpr | undefined;
  onApply(expr: FilterExpr | undefined): void;
}) {
  const {t} = useTranslation('objects');
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<FilterGroup>(() => fromFilterExpr(value));
  useEffect(() => {
    if (open) setGroup(fromFilterExpr(value));
  }, [open, value]);
  const byName = useMemo(
    () => Object.fromEntries(properties.map(p => [p.apiName, p])),
    [properties],
  );
  const n = value ? countConditions(fromFilterExpr(value)) : 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={n ? 'outline' : 'secondary'}>
          <Filter aria-hidden />
          {t('list.filter')}
          {n > 0 && <Badge tone="cyan">{n}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[640px] max-w-[90vw]">
        <FilterBuilder
          value={group}
          onChange={setGroup}
          properties={properties}
          label={t('list.filter')}
        />
        <p className="mt-2 text-xs text-dim">{t('list.indexedOnly')}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onApply(undefined);
              setOpen(false);
            }}
          >
            {t('list.clearFilter')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(toFilterExpr(group, byName));
              setOpen(false);
            }}
          >
            {t('list.applyFilter')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Objects page. */
export function ObjectsPage() {
  const {t} = useTranslation('objects');
  const navigate = useNavigate();
  const search = useLooseSearch();
  const patch = useSearchPatch();
  const {model, isLoading: modelLoading, error: modelError} = useUiModel();
  const stats = useObjectStats();

  const typeName = searchString(search, 'type') ?? model.types[0]?.apiName;
  const type = typeName ? model.byName[typeName] : undefined;
  const filter = parseFilterParam(search.filter);
  const orderBy = parseOrderBy(search.orderBy);
  const [text, setText] = useState(searchString(search, 'q') ?? '');
  const q = useDebouncedValue(text.trim(), 300);
  useEffect(() => {
    if (q !== (searchString(search, 'q') ?? '')) patch({q: q || undefined});
  }, [q]);

  const params = useMemo(
    () => ({
      type: type?.apiName,
      q: q || undefined,
      filter,
      orderBy,
      limit: 100,
    }),
    [type?.apiName, q, search.filter, search.orderBy],
  );
  const list = useObjects(params, !!type);
  // ≤ 300 objects per workspace: fetch remaining pages eagerly.
  useEffect(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);
  const rows = useMemo(
    () => list.data?.pages.flatMap(p => p.items) ?? [],
    [list.data],
  );

  const filterProps = useMemo<RenderProp[]>(
    () =>
      (type?.properties ?? [])
        .filter(p => p.indexed && getRenderer(p.dataType).filterOps.length)
        .map(p => ({...p})),
    [type],
  );

  if (modelError)
    return (
      <ErrorView
        traceId={errorTraceId(modelError)}
        detail={errorMessage(modelError, t)}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={t('list.breadcrumb')}
        title={t('list.title')}
        description={t('list.description')}
      />
      <div
        role="tablist"
        aria-label={t('list.types')}
        className="flex flex-wrap gap-2"
      >
        {modelLoading && <Skeleton className="h-8 w-64" />}
        {model.types.map(ot => {
          const active = ot.apiName === type?.apiName;
          return (
            <button
              key={ot.apiName}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() =>
                patch({type: ot.apiName, filter: undefined, orderBy: undefined})
              }
              className={cn(
                'inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-cyan/60 bg-cyan/10 text-cyan'
                  : 'border-line-2 bg-panel-2 text-muted hover:text-text',
              )}
            >
              <TypeIcon icon={ot.icon} className="size-4" />
              {ot.displayName}
              <span className="num text-xs text-dim">
                {fmt.number(stats.data?.byType[ot.apiName] ?? 0)}
              </span>
            </button>
          );
        })}
      </div>

      <section
        className="glass flex flex-col gap-3 p-4"
        aria-label={type?.displayName}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-dim"
              aria-hidden
            />
            <Input
              className="pl-8"
              value={text}
              aria-label={t('list.search')}
              placeholder={t('list.searchPlaceholder')}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                const v = text.trim();
                if (e.key === 'Enter' && isRid(v))
                  void navigate({to: '/objects/$rid', params: {rid: v}});
              }}
            />
          </div>
          {type && (
            <FilterPopover
              properties={filterProps}
              value={filter}
              onApply={expr => patch({filter: filterParam(expr)})}
            />
          )}
          {(filter || q || orderBy) && (
            <Button
              variant="ghost"
              onClick={() => {
                setText('');
                patch({filter: undefined, q: undefined, orderBy: undefined});
              }}
            >
              <X aria-hidden />
              {t('list.reset')}
            </Button>
          )}
          <span className="ml-auto text-xs text-muted" aria-live="polite">
            {list.isSuccess &&
              t('list.count', {
                count: rows.length,
                total: stats.data?.byType[type?.apiName ?? ''] ?? rows.length,
              })}
          </span>
        </div>

        {list.error ? (
          <ErrorView
            traceId={errorTraceId(list.error)}
            detail={errorMessage(list.error, t)}
            onRetry={() => void list.refetch()}
          />
        ) : !type || list.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({length: 6}, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter || q ? t('list.noMatch') : t('list.empty')}
            description={filter || q ? undefined : t('list.emptyHint')}
            action={
              filter || q ? undefined : (
                <Button onClick={() => void navigate({to: '/imports/new'})}>
                  {t('list.import')}
                </Button>
              )
            }
          />
        ) : (
          <ObjectTable
            type={type}
            rows={rows}
            orderBy={orderBy}
            onSort={prop => {
              const next = nextSort(orderBy, prop);
              patch({orderBy: next ? `${next.prop}:${next.dir}` : undefined});
            }}
            onOpen={o =>
              void navigate({to: '/objects/$rid', params: {rid: o.rid}})
            }
          />
        )}
      </section>
    </div>
  );
}
