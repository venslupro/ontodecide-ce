/**
 * @fileoverview Object table page (/objects/$type): ontology-driven columns,
 * server sort on indexed properties, filter builder synced to the URL,
 * cursor paging with virtual scrolling, text / semantic search, saved
 * Object Sets and a per-type column chooser.
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import type {OrderBy} from '@ontodecide/shared-kernel';
import {Link, useNavigate, useParams, useSearch} from '@tanstack/react-router';
import {
  ArrowLeft,
  Boxes,
  Columns3,
  Filter,
  FolderOpen,
  Save,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {ObjectListSearch} from '../../app/router';
import {
  countConditions,
  fromFilterExpr,
} from '../../entities/object_set/filter_model';
import {parseOrderBy, toObjectSetDef} from '../../entities/object_set/model';
import {useObjectType} from '../../entities/schema/api';
import type {UiObjectType} from '../../entities/schema/model';
import {
  OBJECT_PAGE_DEFAULT,
  useObjectList,
  useObjectSets,
  useSavedObjectSet,
  useSearch as useObjectSearch,
} from '../../features/object-graph/api';
import {ObjectTable} from '../../features/object-graph/components/object_table';
import {TypeIcon} from '../../features/object-graph/components/type_icon';
import {
  filterParam,
  isSortable,
  parseFilterParam,
  resolveColumns,
} from '../../features/object-graph/model';
import {errorMessage} from '../../shared/api/error_message';
import {useDebouncedValue} from '../../shared/lib/hooks';
import {readPrefs, writePrefs} from '../../shared/lib/prefs';
import {track} from '../../shared/lib/telemetry';
import {Badge, DegradedBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card} from '../../shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown_menu';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Input} from '../../shared/ui/input';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {NativeSelect} from '../../shared/ui/select';
import {Skeleton} from '../../shared/ui/skeleton';
import {FilterPanel} from './filter_panel';
import {SaveSetDialog} from './save_set_dialog';

/** /objects/$type — ontology-driven object table. */
export function ObjectListPage() {
  const {t} = useTranslation('objects');
  const params = useParams({strict: false}) as {type?: string};
  const {type, isLoading, error} = useObjectType(params.type);

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-2 h-6 w-48" />
        <Skeleton className="mb-4 h-4 w-72" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <ErrorView detail={errorMessage(error, t)} />
      </Card>
    );
  }
  if (!type) {
    return (
      <Card>
        <EmptyState
          icon={<Boxes aria-hidden />}
          title={t('list.unknownType', {type: params.type ?? ''})}
          description={t('list.unknownTypeHint')}
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
  return <ObjectListView key={type.apiName} type={type} />;
}

function initialHeight(): number {
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  return Math.max(360, h - 290);
}

function ObjectListView({type}: {type: UiObjectType}) {
  const {t} = useTranslation('objects');
  const navigate = useNavigate();
  const search = useSearch({strict: false}) as ObjectListSearch;

  const filter = useMemo(
    () => parseFilterParam(search.filter),
    [search.filter],
  );
  const sort = useMemo<OrderBy | undefined>(() => {
    const o = parseOrderBy(search.sort);
    const p = o && type.properties.find(x => x.apiName === o.prop);
    return p && isSortable(p) ? o : undefined;
  }, [search.sort, type]);
  const activeSet = search.set || undefined;

  const setSearch = useCallback(
    (patch: Partial<ObjectListSearch>, replace = false) => {
      void navigate({
        to: '/objects/$type',
        params: {type: type.apiName},
        search: (prev: ObjectListSearch) => {
          const next: ObjectListSearch = {...prev, ...patch};
          for (const k of Object.keys(next) as (keyof ObjectListSearch)[])
            if (!next[k]) delete next[k];
          return next;
        },
        replace,
      });
    },
    [navigate, type.apiName],
  );

  // --- columns (persisted per type) -----------------------------------------
  const [colNames, setColNames] = useState<string[] | undefined>(
    () => readPrefs().columns?.[type.apiName],
  );
  const columns = useMemo(
    () => resolveColumns(type, colNames),
    [type, colNames],
  );
  const toggleColumn = (name: string, on: boolean) => {
    const current = columns.map(c => c.apiName);
    const next = on
      ? type.properties
          .map(p => p.apiName)
          .filter(n => n === name || current.includes(n))
      : current.filter(n => n !== name);
    setColNames(next);
    writePrefs({
      columns: {...(readPrefs().columns ?? {}), [type.apiName]: next},
    });
  };
  const resetColumns = () => {
    setColNames(undefined);
    const all = {...(readPrefs().columns ?? {})};
    delete all[type.apiName];
    writePrefs({columns: all});
  };

  // --- search (debounced 300 ms, synced to ?q=) -------------------------------
  const [qInput, setQInput] = useState(search.q ?? '');
  const q = useDebouncedValue(qInput.trim(), 300);
  useEffect(() => {
    if ((search.q ?? '') !== q) setSearch({q: q || undefined}, true);
    // Only reacts to the debounced value.
  }, [q]);
  useEffect(() => {
    // External navigation (back/forward) updates the box.
    if ((search.q ?? '') !== qInput.trim()) setQInput(search.q ?? '');
  }, [search.q]);
  const activeQ = (search.q ?? '').trim();

  // --- data -------------------------------------------------------------------
  const listEnabled = !activeQ && !activeSet;
  const list = useObjectList(listEnabled ? type.apiName : undefined, {
    filter,
    orderBy: sort,
    limit: OBJECT_PAGE_DEFAULT,
  });
  const searchRes = useObjectSearch(activeQ, type.apiName, 50);
  const saved = useSavedObjectSet(activeSet);
  const sets = useObjectSets();
  const typeSets = useMemo(
    () =>
      (sets.data ?? []).filter(s => s.definition.objectType === type.apiName),
    [sets.data, type.apiName],
  );
  const activeSetDto = typeSets.find(s => s.id === activeSet);

  const listRows = useMemo<ObjectDto[]>(
    () => list.data?.pages.flatMap(p => p.items) ?? [],
    [list.data],
  );
  const rows: readonly ObjectDto[] = activeQ
    ? (searchRes.data ?? EMPTY_ROWS)
    : activeSet
      ? (saved.data?.items ?? EMPTY_ROWS)
      : listRows;
  const current = activeQ ? searchRes : activeSet ? saved : list;
  const loading = activeQ
    ? searchRes.isLoading
    : activeSet
      ? saved.isLoading
      : list.isLoading;
  const degraded = activeSet
    ? !!saved.data?.degraded
    : !!list.data?.pages.some(p => p.degraded);

  const {hasNextPage, isFetchingNextPage, fetchNextPage} = list;
  const onEndReached = useCallback(() => {
    if (listEnabled && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [listEnabled, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const open = useCallback(
    (r: ObjectDto) =>
      void navigate({to: '/objects/rid/$rid', params: {rid: r.rid}}),
    [navigate],
  );

  useEffect(() => track('page_view:object_list', type.apiName), [type.apiName]);

  const filterCount = useMemo(
    () => countConditions(fromFilterExpr(filter)),
    [filter],
  );
  const [saveOpen, setSaveOpen] = useState(false);

  const emptyNode = activeQ ? (
    <EmptyState
      icon={<SearchX aria-hidden />}
      title={t('list.noSearchResults', {q: activeQ})}
    />
  ) : filter ? (
    <EmptyState
      icon={<Filter aria-hidden />}
      title={t('list.noMatches')}
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSearch({filter: undefined})}
        >
          {t('list.clearFilter')}
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<Boxes aria-hidden />}
      title={t('list.empty')}
      description={t('list.emptyHint')}
    />
  );

  return (
    <div className="fade-in flex flex-col gap-3">
      <PageHeader
        breadcrumb={
          <Link to="/objects" className="hover:text-cyan">
            {t('index.title')}
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-2">
            <TypeIcon icon={type.icon} className="size-5 text-cyan" />
            {type.displayName}
          </span>
        }
        badges={
          <>
            <Mono className="text-dim">{type.apiName}</Mono>
            {degraded && <DegradedBadge />}
          </>
        }
        description={type.description}
        actions={
          <Button
            variant="secondary"
            onClick={() => setSaveOpen(true)}
            disabled={!!activeQ || !!activeSet}
          >
            <Save aria-hidden />
            {t('list.saveSet')}
          </Button>
        }
      />

      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="toolbar"
        aria-label={t('list.toolbar')}
      >
        <div className="relative w-full max-w-sm min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-dim"
            aria-hidden
          />
          <Input
            type="search"
            aria-label={t('list.searchLabel')}
            placeholder={t('list.searchPlaceholder', {type: type.displayName})}
            className="pr-8 pl-8"
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setQInput('');
            }}
          />
          {qInput && (
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-dim hover:text-text"
              aria-label={t('list.clearSearch')}
              onClick={() => setQInput('')}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>

        <FilterPanel
          type={type}
          value={filter}
          count={filterCount}
          disabled={!!activeQ || !!activeSet}
          onApply={f => setSearch({filter: filterParam(f)})}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" aria-label={t('list.columns')}>
              <Columns3 aria-hidden />
              <span className="hidden sm:inline">{t('list.columns')}</span>
              <span className="num text-xs text-dim">
                {columns.length}/{type.properties.length}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>{t('list.columnsHint')}</DropdownMenuLabel>
            {type.properties.map(p => (
              <DropdownMenuCheckboxItem
                key={p.apiName}
                checked={columns.some(c => c.apiName === p.apiName)}
                disabled={p.apiName === type.titleProperty}
                onSelect={e => e.preventDefault()}
                onCheckedChange={c => toggleColumn(p.apiName, c === true)}
              >
                {p.displayName}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetColumns}>
              {t('list.resetColumns')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1.5">
          <FolderOpen className="size-4 text-dim" aria-hidden />
          <NativeSelect
            aria-label={t('list.savedSets')}
            className="min-w-[10rem]"
            value={activeSet ?? ''}
            onChange={e =>
              setSearch({set: e.target.value || undefined, q: undefined})
            }
            placeholder={
              typeSets.length
                ? t('list.savedSetsPlaceholder')
                : t('list.noSavedSets')
            }
            options={typeSets.map(s => ({value: s.id, label: s.name}))}
          />
        </div>

        <p
          className="ml-auto text-xs whitespace-nowrap text-muted"
          aria-live="polite"
        >
          {loading
            ? t('common:state.loading')
            : activeQ
              ? t('list.searchCount', {count: rows.length})
              : listEnabled && hasNextPage
                ? t('list.loadedMore', {count: rows.length})
                : t('list.loadedAll', {count: rows.length})}
        </p>
      </div>

      {(activeQ || activeSet || sort || filter) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {activeQ && (
            <Badge tone="cyan">
              <Search aria-hidden />
              {t('list.searchMode', {q: activeQ})}
              <button
                type="button"
                className="ml-1 hover:text-text"
                aria-label={t('list.clearSearch')}
                onClick={() => setQInput('')}
              >
                <X aria-hidden />
              </button>
            </Badge>
          )}
          {activeSet && (
            <Badge tone="violet">
              <FolderOpen aria-hidden />
              {t('list.setMode', {name: activeSetDto?.name ?? activeSet})}
              <button
                type="button"
                className="ml-1 hover:text-text"
                aria-label={t('list.exitSet')}
                onClick={() => setSearch({set: undefined})}
              >
                <X aria-hidden />
              </button>
            </Badge>
          )}
          {!activeQ && !activeSet && sort && (
            <Badge tone="blue">
              {t('list.sortedBy', {
                name:
                  type.properties.find(p => p.apiName === sort.prop)
                    ?.displayName ?? sort.prop,
              })}{' '}
              {sort.dir === 'asc' ? t('list.asc') : t('list.desc')}
              <button
                type="button"
                className="ml-1 hover:text-text"
                aria-label={t('list.clearSort')}
                onClick={() => setSearch({sort: undefined})}
              >
                <X aria-hidden />
              </button>
            </Badge>
          )}
          {!activeQ && !activeSet && filter && (
            <Badge tone="blue">
              <Filter aria-hidden />
              {t('list.filterActive', {count: filterCount})}
              <button
                type="button"
                className="ml-1 hover:text-text"
                aria-label={t('list.clearFilter')}
                onClick={() => setSearch({filter: undefined})}
              >
                <X aria-hidden />
              </button>
            </Badge>
          )}
        </div>
      )}

      {current.error ? (
        <Card>
          <ErrorView
            detail={errorMessage(current.error, t)}
            onRetry={() => void current.refetch()}
          />
        </Card>
      ) : (
        <ObjectTable
          type={type}
          rows={rows}
          columns={columns}
          sort={sort}
          sortDisabled={!!activeQ || !!activeSet}
          onSortChange={s =>
            setSearch({sort: s ? `${s.prop}:${s.dir}` : undefined})
          }
          onOpen={open}
          onEndReached={onEndReached}
          loading={loading}
          loadingMore={listEnabled && isFetchingNextPage}
          height={initialHeight()}
          label={t('list.tableLabel', {type: type.displayName})}
          empty={emptyNode}
        />
      )}

      <SaveSetDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        definition={toObjectSetDef(type.apiName, filter, sort)}
        onSaved={id => setSearch({set: id})}
      />
    </div>
  );
}

const EMPTY_ROWS: readonly ObjectDto[] = [];
