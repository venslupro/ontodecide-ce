/**
 * @fileoverview Object View property table: schema order, renderer cells,
 * provenance (source, ingested time, confidence) and a lineage popover with
 * the overwritten history (≤ 5). Rows carry `id="prop-<apiName>"`; a
 * matching `location.hash` scrolls to, highlights and opens that row's
 * lineage (evidence-chain deep links).
 */

import type {LineageDto, ObjectDto} from '@ontodecide/object-graph/contract';
import type {Provenance} from '@ontodecide/shared-kernel';
import {useLocation} from '@tanstack/react-router';
import {GitBranch, Lock} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getRenderer} from '../../../entities/renderers/registry';
import type {UiObjectType, UiProperty} from '../../../entities/schema/model';
import {orderedProperties} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '../../../shared/ui/popover';
import {Skeleton} from '../../../shared/ui/skeleton';
import {useLineage} from '../api';

/** Reads the `prop-<name>` target from the URL hash. */
export function useHashProp(): string | undefined {
  const hash = useLocation({select: l => l.hash});
  const h = (hash ?? '').replace(/^#/, '');
  return h.startsWith('prop-') ? h.slice(5) : undefined;
}

/** Property table props. */
export interface PropertyTableProps {
  type: UiObjectType;
  object: ObjectDto;
}

/** Schema-ordered property table with provenance and lineage. */
export function PropertyTable({type, object}: PropertyTableProps) {
  const {t} = useTranslation('objects');
  const target = useHashProp();
  const [openProp, setOpenProp] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const lineage = useLineage(object.rid, openProp !== null || !!target);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!target) return undefined;
    const el = document.getElementById(`prop-${target}`);
    if (!el) return undefined;
    el.scrollIntoView({block: 'center', behavior: 'smooth'});
    setHighlight(target);
    setOpenProp(target);
    setPinned(true);
    const id = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(id);
  }, [target, object.rid]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const props = orderedProperties(type);
  const hidden = new Set(object.hiddenProps ?? []);

  const show = (name: string, pin: boolean) => {
    clearTimeout(hoverTimer.current);
    if (pin) {
      const toggleOff = openProp === name && pinned;
      setOpenProp(toggleOff ? null : name);
      setPinned(!toggleOff);
      return;
    }
    if (!pinned) hoverTimer.current = setTimeout(() => setOpenProp(name), 200);
  };
  const hide = () => {
    clearTimeout(hoverTimer.current);
    if (!pinned) hoverTimer.current = setTimeout(() => setOpenProp(null), 150);
  };

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        aria-label={t('view.properties')}
      >
        <thead>
          <tr className="border-b border-line-2 text-left text-xs text-muted">
            <th
              scope="col"
              className="w-[28%] px-3 py-2 font-medium whitespace-nowrap"
            >
              {t('view.property')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              {t('view.value')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              {t('view.source')}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.map(p => {
            const isHidden = !p.visible || hidden.has(p.apiName);
            return (
              <PropertyRow
                key={p.apiName}
                prop={p}
                object={object}
                isHidden={isHidden}
                highlighted={highlight === p.apiName}
                open={openProp === p.apiName && !isHidden}
                lineage={lineage.data}
                lineageLoading={lineage.isLoading}
                onShow={pin => show(p.apiName, pin)}
                onHide={hide}
                onClose={() => {
                  setOpenProp(null);
                  setPinned(false);
                }}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PropertyRow({
  prop,
  object,
  isHidden,
  highlighted,
  open,
  lineage,
  lineageLoading,
  onShow,
  onHide,
  onClose,
}: {
  prop: UiProperty;
  object: ObjectDto;
  isHidden: boolean;
  highlighted: boolean;
  open: boolean;
  lineage?: LineageDto;
  lineageLoading: boolean;
  onShow(pin: boolean): void;
  onHide(): void;
  onClose(): void;
}) {
  const {t} = useTranslation('objects');
  const r = getRenderer(prop.dataType);
  const prov = object.provenance?.[prop.apiName];
  return (
    <tr
      id={`prop-${prop.apiName}`}
      data-highlighted={highlighted || undefined}
      className={cn(
        'scroll-mt-24 border-b border-line align-top transition-colors hover:bg-panel-2/60',
        highlighted && 'bg-cyan/10 ring-1 ring-cyan/60 ring-inset',
      )}
    >
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="flex items-center gap-1.5 text-muted">
          {isHidden && (
            <Lock className="size-3.5 shrink-0 text-dim" aria-hidden />
          )}
          <span className="text-text">{prop.displayName}</span>
          {prop.sensitive && !isHidden && (
            <span className="text-[10px] text-orange">
              {t('view.sensitive')}
            </span>
          )}
        </span>
        <span className="font-mono text-[10px] text-dim">{prop.apiName}</span>
      </th>
      <td className={cn('px-3 py-2', r.align === 'right' && 'num')}>
        {isHidden ? (
          <span className="inline-flex items-center gap-1 text-xs text-dim">
            <Lock className="size-3" aria-hidden />
            {t('view.noAccess')}
          </span>
        ) : (
          r.cell(object.props[prop.apiName], prop)
        )}
      </td>
      <td className="px-3 py-2">
        {isHidden ? (
          <span className="text-xs text-dim">—</span>
        ) : (
          <Popover
            open={open}
            onOpenChange={o => (o ? onShow(true) : onClose())}
          >
            <PopoverAnchor asChild>
              <button
                type="button"
                className="group flex max-w-full flex-col items-start rounded-md px-1 py-0.5 text-left hover:bg-panel-2 focus-visible:bg-panel-2"
                aria-expanded={open}
                aria-label={t('view.lineageFor', {name: prop.displayName})}
                onClick={() => onShow(true)}
                onMouseEnter={() => onShow(false)}
                onMouseLeave={onHide}
              >
                {prov ? (
                  <ProvenanceLine prov={prov} />
                ) : (
                  <span className="text-xs text-dim">{t('view.noSource')}</span>
                )}
              </button>
            </PopoverAnchor>
            <PopoverContent
              align="end"
              className="w-80"
              onOpenAutoFocus={e => e.preventDefault()}
              onMouseEnter={() => onShow(false)}
              onMouseLeave={onHide}
            >
              <LineagePanel
                prop={prop}
                lineage={lineage}
                loading={lineageLoading}
                fallback={prov}
                value={object.props[prop.apiName]}
              />
            </PopoverContent>
          </Popover>
        )}
      </td>
    </tr>
  );
}

function ProvenanceLine({prov}: {prov: Provenance}) {
  const {t} = useTranslation('objects');
  return (
    <>
      <span className="flex items-center gap-1 text-xs text-text">
        <GitBranch className="size-3 shrink-0 text-cyan" aria-hidden />
        <span className="truncate font-mono">{prov.sourceId}</span>
      </span>
      <span className="text-[11px] text-dim">
        <time dateTime={prov.ingestedAt} title={fmt.dateTime(prov.ingestedAt)}>
          {fmt.ago(prov.ingestedAt)}
        </time>
        {' · '}
        {t('view.confidence', {value: prov.confidence})}
      </span>
    </>
  );
}

function LineagePanel({
  prop,
  lineage,
  loading,
  fallback,
  value,
}: {
  prop: UiProperty;
  lineage?: LineageDto;
  loading: boolean;
  fallback?: Provenance;
  value: unknown;
}) {
  const {t} = useTranslation('objects');
  const r = getRenderer(prop.dataType);
  const entry = lineage?.props[prop.apiName];
  const current = entry?.current ?? fallback ?? null;
  const history = (entry?.history ?? []).slice(0, 5);
  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`lineage-${prop.apiName}`}
    >
      <p className="text-xs font-semibold text-text">
        {t('view.lineageTitle', {name: prop.displayName})}
      </p>
      <div className="rounded-md border border-cyan/30 bg-cyan/5 p-2">
        <p className="mb-1 text-[10px] font-medium tracking-wide text-cyan uppercase">
          {t('view.lineageCurrent')}
        </p>
        <p className="text-sm text-text">
          {r.text(entry?.value ?? value, prop)}
        </p>
        {current ? (
          <LineageMeta prov={current} />
        ) : (
          <p className="text-xs text-dim">{t('view.noSource')}</p>
        )}
      </div>
      <div>
        <p className="mb-1 text-[10px] font-medium tracking-wide text-muted uppercase">
          {t('view.lineageHistory')}
        </p>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : history.length === 0 ? (
          <p className="text-xs text-dim">{t('view.lineageNoHistory')}</p>
        ) : (
          <ol className="flex flex-col gap-1.5 border-l border-line-2 pl-3">
            {history.map((h, i) => (
              <li
                key={`${h.sourceId}-${h.ingestedAt}-${i}`}
                className="text-xs"
              >
                <span className="text-text">{r.text(h.value, prop)}</span>
                <LineageMeta prov={h} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function LineageMeta({prov}: {prov: Provenance}) {
  const {t} = useTranslation('objects');
  return (
    <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-[11px] text-muted">
      <dt className="text-dim">{t('view.lineageSource')}</dt>
      <dd className="truncate font-mono">{prov.sourceId}</dd>
      <dt className="text-dim">{t('view.lineageRecord')}</dt>
      <dd className="truncate font-mono">{prov.recordRef}</dd>
      <dt className="text-dim">{t('view.lineageTime')}</dt>
      <dd>
        <time dateTime={prov.ingestedAt}>{fmt.dateTime(prov.ingestedAt)}</time>
      </dd>
      <dt className="text-dim">{t('view.lineageConfidence')}</dt>
      <dd className="num">{fmt.percent(prov.confidence)}</dd>
    </dl>
  );
}
