/**
 * @fileoverview Global search (object name or RID; GET /objects?q=, 300 ms
 * debounce, ⌘K / Ctrl+K). A pasted RID opens its Object View directly.
 */

import type {ObjectSummary} from '@ontodecide/object-graph/contract';
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
  const {data, isFetching} = useObjectSearch(isRid(q) ? '' : q);
  const results = data ?? [];

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
            else if (results[active]) go(results[active].rid);
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
            results.map((o, i) => (
              <li
                key={o.rid}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={e => {
                  e.preventDefault();
                  go(o.rid);
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm',
                  i === active ? 'bg-panel-2 text-cyan' : 'hover:bg-panel-2',
                )}
              >
                <span className="truncate">{o.title}</span>
                <span className="shrink-0 font-mono text-xs text-dim">
                  {o.type}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
