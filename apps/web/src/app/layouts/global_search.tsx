/**
 * @fileoverview Global search (前端详细设计 2.1: 对象名 / RID / 告警): objects
 * via GET /objects?q= and alerts via GET /alerts (latest 100, filtered by
 * title on the client), shown in two groups; 300 ms debounce, ⌘K / Ctrl+K.
 * A pasted RID opens its Object View directly.
 */

import type {ObjectSummary} from '@ontodecide/object-graph/contract';
import type {PageResult} from '@ontodecide/shared-kernel';
import type {AlertDto} from '@ontodecide/situation/contract';
import {isRid} from '@ontodecide/shared-kernel';
import {useQuery} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {Search} from 'lucide-react';
import {useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api, asList} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';
import {cn} from '../../shared/lib/cn';
import {useDebouncedValue} from '../../shared/lib/hooks';

/** Search results (≤ 8). */
export function useObjectSearch(q: string) {
  return useQuery({
    queryKey: qk.search(q),
    queryFn: async () =>
      asList(
        await api.get<ObjectSummary[] | {items: ObjectSummary[]}>('/objects', {
          query: {q, limit: 8},
        }),
      ),
    enabled: q.length > 0,
    staleTime: 30_000,
  });
}

/** Alerts fetched once for title search (client-side filter). */
export const ALERT_SEARCH_LIMIT = 100;
/** Alert matches shown. */
export const ALERT_MATCHES = 5;

/** Alerts whose title contains `q` (case-insensitive), newest first. */
export function filterAlerts(
  alerts: readonly AlertDto[],
  q: string,
  max = ALERT_MATCHES,
): AlertDto[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return alerts
    .filter(a => a.title.toLowerCase().includes(needle))
    .sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : -1))
    .slice(0, max);
}

/** Alert matches for the search box (one GET /alerts per 30 s). */
export function useAlertSearch(q: string) {
  return useQuery({
    queryKey: qk.alerts({limit: ALERT_SEARCH_LIMIT, purpose: 'search'}),
    queryFn: async () =>
      (
        await api.get<PageResult<AlertDto>>('/alerts', {
          query: {limit: ALERT_SEARCH_LIMIT},
        })
      )?.items ?? [],
    enabled: q.length > 0,
    staleTime: 30_000,
    select: list => filterAlerts(list, q),
  });
}

/** One selectable search result. */
type Hit =
  | {kind: 'object'; key: string; object: ObjectSummary}
  | {kind: 'alert'; key: string; alert: AlertDto};

/** Global search combobox. */
export function GlobalSearch() {
  const {t} = useTranslation('common');
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebouncedValue(text.trim(), 300);
  const term = isRid(q) ? '' : q;
  const objects = useObjectSearch(term);
  const alerts = useAlertSearch(term);
  const isFetching = objects.isFetching || alerts.isFetching;
  const results: Hit[] = [
    ...(objects.data ?? []).map((o): Hit => ({
      kind: 'object',
      key: `o:${o.rid}`,
      object: o,
    })),
    ...(alerts.data ?? []).map((a): Hit => ({
      kind: 'alert',
      key: `a:${a.id}`,
      alert: a,
    })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (rid: string) => {
    setOpen(false);
    setText('');
    void navigate({to: '/objects/$rid', params: {rid}});
  };
  const pick = (h: Hit) => {
    if (h.kind === 'object') return go(h.object.rid);
    if (h.alert.rid) return go(h.alert.rid);
    setOpen(false);
    setText('');
    void navigate({to: '/cockpit'});
  };

  const option = (h: Hit, i: number) => (
    <li
      key={h.key}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === active}
      onMouseDown={e => {
        e.preventDefault();
        pick(h);
      }}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm',
        i === active ? 'bg-panel-2 text-cyan' : 'hover:bg-panel-2',
      )}
    >
      {h.kind === 'object' ? (
        <>
          <span className="truncate">{h.object.title}</span>
          <span className="shrink-0 font-mono text-xs text-dim">
            {h.object.type}
          </span>
        </>
      ) : (
        <>
          <span className="truncate">{h.alert.title}</span>
          <span className="shrink-0 text-xs text-dim">
            {t(`severity.${h.alert.severity}`, {
              defaultValue: h.alert.severity,
            })}
          </span>
        </>
      )}
    </li>
  );
  const objectHits = results.filter(h => h.kind === 'object');
  const alertHits = results.filter(h => h.kind === 'alert');

  return (
    <div className="relative w-full max-w-[500px]">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && q.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && results[active] ? `${listId}-${active}` : undefined
        }
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        className="h-10 w-full rounded-[10px] border border-line-2 bg-panel-2 pr-12 pl-9 text-sm text-text outline-none placeholder:text-dim focus-visible:border-cyan"
        value={text}
        onChange={e => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(a => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(a => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            const v = text.trim();
            if (isRid(v)) go(v);
            else if (results[active]) pick(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-line-2 px-1.5 text-[10px] text-dim">
        ⌘K
      </kbd>
      {open && q.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-[10px] border border-line-2 bg-panel-solid p-1 shadow-[var(--shadow)]"
        >
          {isRid(q) ? (
            <li
              role="option"
              aria-selected
              className="cursor-pointer rounded-md px-2 py-1.5 text-sm hover:bg-panel-2"
              onMouseDown={() => go(q)}
            >
              {t('search.openRid')}{' '}
              <span className="font-mono text-xs text-cyan">{q}</span>
            </li>
          ) : results.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-dim">
              {isFetching ? t('state.loading') : t('state.noResults')}
            </li>
          ) : (
            <>
              {objectHits.length > 0 && (
                <li role="presentation">
                  <p className="px-2 pt-1 pb-0.5 text-[11px] text-dim">
                    {t('search.groupObjects')}
                  </p>
                  <ul role="group" aria-label={t('search.groupObjects')}>
                    {objectHits.map((h, i) => option(h, i))}
                  </ul>
                </li>
              )}
              {alertHits.length > 0 && (
                <li role="presentation">
                  <p className="px-2 pt-1 pb-0.5 text-[11px] text-dim">
                    {t('search.groupAlerts')}
                  </p>
                  <ul role="group" aria-label={t('search.groupAlerts')}>
                    {alertHits.map((h, i) => option(h, objectHits.length + i))}
                  </ul>
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
