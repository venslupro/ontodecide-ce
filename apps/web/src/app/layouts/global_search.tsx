/**
 * @fileoverview Global object search (name or RID, 300 ms debounce). A
 * pasted RID navigates straight to its Object View.
 */

import {isRid} from '@ontodecide/shared-kernel';
import {useNavigate} from '@tanstack/react-router';
import {Search} from 'lucide-react';
import {useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../entities/schema/api';
import {useSearch} from '../../features/object-graph/api';
import {cn} from '../../shared/lib/cn';
import {useDebouncedValue} from '../../shared/lib/hooks';

/** Global search combobox. */
export function GlobalSearch() {
  const {t} = useTranslation('common');
  const navigate = useNavigate();
  const {model} = useUiModel();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebouncedValue(text.trim(), 300);
  const {data, isFetching} = useSearch(isRid(q) ? '' : q, undefined, 8);
  const results = data ?? [];

  const go = (rid: string) => {
    setOpen(false);
    setText('');
    void navigate({to: '/objects/rid/$rid', params: {rid}});
  };

  return (
    <div className="relative w-full max-w-md">
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
        aria-activedescendant={
          open && results[active] ? `${listId}-${active}` : undefined
        }
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        className="h-9 w-full rounded-[10px] border border-line-2 bg-panel-2 pr-3 pl-9 text-sm text-text outline-none placeholder:text-dim focus-visible:border-cyan"
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
                <span className="shrink-0 text-xs text-dim">
                  {model.byName[o.type]?.displayName ?? o.type}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
