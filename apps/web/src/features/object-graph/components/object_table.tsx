/**
 * @fileoverview Ontology-driven object table: columns come from the object
 * type's properties, cells from the renderer registry, sortable headers
 * for indexed properties (the only ones D1 can order by). More than 100
 * rows are virtualized with TanStack Virtual (300 rows re-render ≤ 16 ms).
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import type {OrderBy} from '@ontodecide/shared-kernel';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import {useVirtualizer} from '@tanstack/react-virtual';
import {ArrowDown, ArrowUp, ArrowUpDown} from 'lucide-react';
import {useMemo, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import type {UiObjectType, UiProperty} from '../../../entities/schema/model';
import {getRenderer} from '../../../entities/renderers/registry';
import {cn} from '../../../shared/lib/cn';
import {isSortable, resolveColumns, VIRTUALIZE_ABOVE} from '../model';

const helper = createColumnHelper<ObjectDto>();
const ROW_HEIGHT = 38;

function SortIcon({dir}: {dir?: 'asc' | 'desc'}) {
  if (dir === 'asc') return <ArrowUp className="size-3" aria-hidden />;
  if (dir === 'desc') return <ArrowDown className="size-3" aria-hidden />;
  return <ArrowUpDown className="size-3 opacity-40" aria-hidden />;
}

/** Object table props. */
export interface ObjectTableProps {
  type: UiObjectType;
  rows: readonly ObjectDto[];
  orderBy?: OrderBy;
  onSort?(prop: string): void;
  onOpen(obj: ObjectDto): void;
  /** Force virtualization regardless of the row count (tests). */
  virtualize?: boolean;
  className?: string;
}

/** The table. */
export function ObjectTable({
  type,
  rows,
  orderBy,
  onSort,
  onOpen,
  virtualize,
  className,
}: ObjectTableProps) {
  const {t} = useTranslation('objects');
  const columns = useMemo<ColumnDef<ObjectDto, unknown>[]>(
    () =>
      resolveColumns(type).map((p: UiProperty) =>
        helper.accessor(o => o.props[p.apiName], {
          id: p.apiName,
          header: p.displayName,
          cell: info => getRenderer(p.dataType).cell(info.getValue(), p),
          meta: p,
        }),
      ),
    [type],
  );
  const table = useReactTable({
    data: rows as ObjectDto[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: o => o.rid,
  });
  const all = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = virtualize ?? rows.length > VIRTUALIZE_ABOVE;
  const v = useVirtualizer({
    count: all.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: {width: 1200, height: 640},
    enabled: virtual,
  });
  const items = virtual ? v.getVirtualItems() : null;
  const padTop = items?.length ? items[0].start : 0;
  const padBottom = items?.length
    ? v.getTotalSize() - items[items.length - 1].end
    : 0;
  const visible = items ? items.map(i => all[i.index]) : all;
  const colSpan = columns.length;

  return (
    <div
      ref={scrollRef}
      className={cn(
        'relative max-h-[calc(100vh-280px)] overflow-auto',
        className,
      )}
      data-virtualized={virtual || undefined}
    >
      <table
        className="w-full border-collapse text-sm"
        aria-rowcount={rows.length + 1}
      >
        <thead className="sticky top-0 z-[1] bg-panel-solid">
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id} className="border-b border-line">
              {hg.headers.map(h => {
                const p = h.column.columnDef.meta as UiProperty;
                const sortable = !!onSort && isSortable(p);
                const dir =
                  orderBy?.prop === p.apiName ? orderBy.dir : undefined;
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={
                      dir === 'asc'
                        ? 'ascending'
                        : dir === 'desc'
                          ? 'descending'
                          : undefined
                    }
                    className={cn(
                      'h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted',
                      getRenderer(p.dataType).align === 'right' && 'text-right',
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort?.(p.apiName)}
                        className="inline-flex items-center gap-1 hover:text-text"
                        aria-label={t('list.sortBy', {prop: p.displayName})}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <SortIcon dir={dir} />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden style={{height: padTop}}>
              <td colSpan={colSpan} />
            </tr>
          )}
          {visible.map(row => (
            <tr
              key={row.id}
              tabIndex={0}
              aria-rowindex={row.index + 2}
              onClick={() => onOpen(row.original)}
              onKeyDown={e => {
                if (e.key === 'Enter') onOpen(row.original);
              }}
              className="cursor-pointer border-b border-line transition-colors hover:bg-panel-2/70 focus-visible:bg-panel-2 focus-visible:outline-none"
              style={{height: ROW_HEIGHT}}
            >
              {row.getVisibleCells().map((c, i) => {
                const p = c.column.columnDef.meta as UiProperty;
                return (
                  <td
                    key={c.id}
                    className={cn(
                      'px-3 py-1.5 align-middle text-text',
                      getRenderer(p.dataType).align === 'right' && 'text-right',
                      i === 0 && 'font-medium',
                    )}
                  >
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
          {padBottom > 0 && (
            <tr aria-hidden style={{height: padBottom}}>
              <td colSpan={colSpan} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
