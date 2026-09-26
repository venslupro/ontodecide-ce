/**
 * @fileoverview Ontology-driven, virtualized object table. Columns come from
 * the UiObjectType (schema order), cells from the renderer registry; only
 * indexed properties are sortable (server `orderBy`); properties hidden by
 * markings show a lock. Rows are virtualized with a fixed row height so the
 * table stays smooth for 10k+ rows (前端详细设计 表 2).
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import type {OrderBy} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {
  observeElementRect,
  useVirtualizer,
  type Virtualizer,
} from '@tanstack/react-virtual';
import {ArrowDown, ArrowUp, ArrowUpDown, Lock} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {useTranslation} from 'react-i18next';
import {getRenderer, HiddenValue} from '../../../entities/renderers/registry';
import type {UiObjectType, UiProperty} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {Skeleton} from '../../../shared/ui/skeleton';
import {Tooltip} from '../../../shared/ui/tooltip';
import {columnWidth, isSortable, nextSort} from '../model';

/** Fixed row height (px) — required for cheap virtualization. */
export const OBJECT_ROW_HEIGHT = 40;

/** Rows from the end at which `onEndReached` fires. */
const END_THRESHOLD = 15;

/** Object table props. */
export interface ObjectTableProps {
  type: UiObjectType;
  rows: readonly ObjectDto[];
  /** Visible columns in display order (defaults to every property). */
  columns: readonly UiProperty[];
  sort?: OrderBy;
  onSortChange?(next: OrderBy | undefined): void;
  /** Row activation (click / Enter). */
  onOpen?(row: ObjectDto): void;
  /** Called when the user scrolls near the end (fetch next page). */
  onEndReached?(): void;
  /** Initial load: show skeleton rows. */
  loading?: boolean;
  /** A further page is loading. */
  loadingMore?: boolean;
  /** Scroll container height (px). */
  height?: number;
  /** Rendered when there are no rows. */
  empty?: ReactNode;
  /** Accessible table name. */
  label: string;
  /** Sorting disabled (e.g. search results / saved sets). */
  sortDisabled?: boolean;
}

interface Col {
  prop: UiProperty;
  isTitle: boolean;
  width: number;
}

/** Virtualized, ontology-driven object table. */
export function ObjectTable({
  type,
  rows,
  columns,
  sort,
  onSortChange,
  onOpen,
  onEndReached,
  loading,
  loadingMore,
  height = 560,
  empty,
  label,
  sortDisabled,
}: ObjectTableProps) {
  const {t} = useTranslation('objects');
  const scrollRef = useRef<HTMLDivElement>(null);

  const cols = useMemo<Col[]>(
    () =>
      columns.map(p => {
        const isTitle = p.apiName === type.titleProperty;
        return {prop: p, isTitle, width: columnWidth(p, isTitle)};
      }),
    [columns, type.titleProperty],
  );
  const template = useMemo(
    () => cols.map(c => `minmax(${c.width}px, 1fr)`).join(' '),
    [cols],
  );
  const minWidth = useMemo(() => cols.reduce((n, c) => n + c.width, 0), [cols]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => OBJECT_ROW_HEIGHT,
    overscan: 12,
    getItemKey: i => rows[i]?.rid ?? i,
    // Zero-sized containers (hidden tabs, jsdom) fall back to the configured height.
    observeElementRect: (inst: Virtualizer<HTMLDivElement, Element>, cb) =>
      observeElementRect(inst, r =>
        cb(
          r.height > 0
            ? r
            : {width: r.width || minWidth, height: height - OBJECT_ROW_HEIGHT},
        ),
      ),
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length ? items[items.length - 1].index : -1;

  const endRef = useRef(onEndReached);
  endRef.current = onEndReached;
  useEffect(() => {
    if (rows.length > 0 && lastIndex >= rows.length - END_THRESHOLD)
      endRef.current?.();
  }, [lastIndex, rows.length]);

  const open = useCallback((r: ObjectDto) => onOpen?.(r), [onOpen]);

  return (
    <div
      ref={scrollRef}
      className="relative overflow-auto rounded-[10px] border border-line"
      style={{height}}
      data-testid="object-table-scroll"
    >
      <div
        role="table"
        aria-label={label}
        aria-rowcount={rows.length + 1}
        aria-busy={loading || loadingMore || undefined}
        style={{minWidth}}
      >
        <div
          role="rowgroup"
          className="sticky top-0 z-[2] border-b border-line-2 bg-panel-solid"
        >
          <div
            role="row"
            aria-rowindex={1}
            className="grid"
            style={{gridTemplateColumns: template, height: OBJECT_ROW_HEIGHT}}
          >
            {cols.map(c => (
              <HeaderCell
                key={c.prop.apiName}
                col={c}
                sort={sort}
                disabled={sortDisabled || !onSortChange}
                onSort={() => onSortChange?.(nextSort(sort, c.prop.apiName))}
              />
            ))}
          </div>
        </div>
        {loading ? (
          <div role="rowgroup">
            {Array.from({length: 8}, (_, i) => (
              <div
                key={i}
                role="row"
                className="grid items-center border-b border-line px-0"
                style={{
                  gridTemplateColumns: template,
                  height: OBJECT_ROW_HEIGHT,
                }}
              >
                {cols.map(c => (
                  <div key={c.prop.apiName} role="cell" className="px-3">
                    <Skeleton className="h-3.5 w-3/4" />
                  </div>
                ))}
              </div>
            ))}
            <span className="sr-only" role="status">
              {t('common:state.loading')}
            </span>
          </div>
        ) : rows.length === 0 ? null : (
          <div
            role="rowgroup"
            className="relative"
            style={{height: virtualizer.getTotalSize()}}
          >
            {items.map(vi => {
              const row = rows[vi.index];
              if (!row) return null;
              return (
                <ObjectRow
                  key={vi.key}
                  row={row}
                  index={vi.index}
                  start={vi.start}
                  cols={cols}
                  template={template}
                  onOpen={open}
                />
              );
            })}
          </div>
        )}
      </div>
      {!loading && rows.length === 0 && (
        <div className="sticky left-0">{empty}</div>
      )}
      {loadingMore && (
        <div
          className="sticky bottom-0 left-0 flex items-center justify-center gap-2 border-t border-line bg-panel-solid/90 py-1.5 text-xs text-muted"
          role="status"
        >
          <Skeleton className="size-3 rounded-full" />
          {t('table.loadingMore')}
        </div>
      )}
    </div>
  );
}

function HeaderCell({
  col,
  sort,
  disabled,
  onSort,
}: {
  col: Col;
  sort?: OrderBy;
  disabled?: boolean;
  onSort(): void;
}) {
  const {t} = useTranslation('objects');
  const p = col.prop;
  const sortable = isSortable(p) && !disabled;
  const active = sort?.prop === p.apiName ? sort.dir : undefined;
  const ariaSort =
    active === 'asc'
      ? 'ascending'
      : active === 'desc'
        ? 'descending'
        : sortable
          ? 'none'
          : undefined;
  const alignRight = getRenderer(p.dataType).align === 'right';
  const labelNode = (
    <span className="inline-flex min-w-0 items-center gap-1">
      {!p.visible && (
        <Lock
          className="size-3 shrink-0 text-dim"
          aria-label={t('table.hiddenColumn')}
          role="img"
        />
      )}
      <span className="truncate">{p.displayName}</span>
      {p.unit && (
        <span className="shrink-0 text-[10px] text-dim">({p.unit})</span>
      )}
    </span>
  );
  return (
    <div
      role="columnheader"
      aria-sort={ariaSort}
      data-prop={p.apiName}
      className={cn(
        'flex min-w-0 items-center px-3 text-xs font-medium whitespace-nowrap text-muted',
        alignRight && 'justify-end',
        col.isTitle && 'sticky left-0 z-[1] bg-panel-solid',
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:text-text',
            active && 'text-cyan',
          )}
          aria-label={t('table.sortBy', {name: p.displayName})}
        >
          {labelNode}
          {active === 'asc' ? (
            <ArrowUp className="size-3 shrink-0" aria-hidden />
          ) : active === 'desc' ? (
            <ArrowDown className="size-3 shrink-0" aria-hidden />
          ) : (
            <ArrowUpDown className="size-3 shrink-0 opacity-40" aria-hidden />
          )}
        </button>
      ) : (
        <Tooltip
          content={
            !p.visible
              ? t('table.hiddenColumn')
              : isSortable(p)
                ? undefined
                : t('table.notSortable')
          }
        >
          <span
            className="inline-flex min-w-0 cursor-default items-center px-1"
            title={
              !p.visible
                ? t('table.hiddenColumn')
                : isSortable(p)
                  ? undefined
                  : t('table.notSortable')
            }
          >
            {labelNode}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

const ObjectRow = memo(
  ({
    row,
    index,
    start,
    cols,
    template,
    onOpen,
  }: {
    row: ObjectDto;
    index: number;
    start: number;
    cols: Col[];
    template: string;
    onOpen(r: ObjectDto): void;
  }) => {
    const hidden = row.hiddenProps;
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) {
        e.preventDefault();
        onOpen(row);
      }
    };
    return (
      <div
        role="row"
        aria-rowindex={index + 2}
        tabIndex={0}
        data-rid={row.rid}
        onClick={() => onOpen(row)}
        onKeyDown={onKeyDown}
        className="group absolute top-0 left-0 grid w-full cursor-pointer items-center border-b border-line transition-colors outline-none hover:bg-panel-2/70 focus-visible:bg-cyan/10"
        style={{
          gridTemplateColumns: template,
          height: OBJECT_ROW_HEIGHT,
          transform: `translateY(${start}px)`,
        }}
      >
        {cols.map(c => {
          const p = c.prop;
          const isHidden = !p.visible || (hidden?.includes(p.apiName) ?? false);
          const r = getRenderer(p.dataType);
          return (
            <div
              key={p.apiName}
              role="cell"
              className={cn(
                'min-w-0 truncate px-3 text-sm text-text',
                r.align === 'right' && 'text-right',
                c.isTitle &&
                  'sticky left-0 z-[1] bg-panel-solid group-hover:bg-panel-2 group-focus-visible:bg-panel-2',
              )}
            >
              {isHidden ? (
                <HiddenValue />
              ) : c.isTitle ? (
                <Link
                  to="/objects/rid/$rid"
                  params={{rid: row.rid}}
                  className="font-medium text-cyan hover:underline"
                  onClick={e => e.stopPropagation()}
                  tabIndex={-1}
                >
                  {row.props[p.apiName] !== undefined &&
                  row.props[p.apiName] !== null
                    ? r.text(row.props[p.apiName], p)
                    : row.title}
                </Link>
              ) : (
                r.cell(row.props[p.apiName], p)
              )}
            </div>
          );
        })}
      </div>
    );
  },
);
