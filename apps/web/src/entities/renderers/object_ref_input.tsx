/**
 * @fileoverview Object picker bound to an `objectRef:<Type>` value: searches
 * objects by name/RID (300 ms debounce) and shows suggested candidates.
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import {useQuery} from '@tanstack/react-query';
import {Search} from 'lucide-react';
import {useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {api, asList} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';
import {cn} from '../../shared/lib/cn';
import {useDebouncedValue} from '../../shared/lib/hooks';
import {Input} from '../../shared/ui/input';

/** Searches objects. */
export async function searchObjects(
  q: string,
  type?: string,
  limit = 10,
): Promise<ObjectDto[]> {
  const res = await api.get<ObjectDto[] | {items: ObjectDto[]}>('/search', {
    query: {q, type, limit},
  });
  return asList(res);
}

/** Object picker. */
export function ObjectRefInput({
  id,
  objectType,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
  suggestions,
  label,
}: {
  id?: string;
  objectType?: string;
  value: string;
  onChange(rid: string): void;
  onBlur?(): void;
  invalid?: boolean;
  disabled?: boolean;
  suggestions?: {rid: string; title: string}[];
  label?: string;
}) {
  const {t} = useTranslation('common');
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{rid: string; title: string} | null>(
    null,
  );
  const q = useDebouncedValue(text.trim(), 300);
  const results = useQuery({
    queryKey: qk.search(q, objectType),
    queryFn: () => searchObjects(q, objectType),
    enabled: open && q.length >= 1,
    staleTime: 30_000,
  });
  const options: {rid: string; title: string; suggested?: boolean}[] = [
    ...(q ? [] : (suggestions ?? []).map(s => ({...s, suggested: true}))),
    ...(results.data ?? []).map(o => ({rid: o.rid, title: o.title})),
  ];
  const display = picked?.rid === value ? picked.title : value;

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim"
          aria-hidden
        />
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="pl-8"
          placeholder={t('picker.placeholder')}
          value={open ? text : display}
          onFocus={() => {
            setText('');
            setOpen(true);
          }}
          onChange={e => setText(e.target.value)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 150);
            onBlur?.();
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-[10px] border border-line-2 bg-panel-solid p-1 shadow-[var(--shadow)]"
        >
          {options.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-dim">
              {results.isFetching
                ? t('state.loading')
                : q
                  ? t('state.noResults')
                  : t('picker.typeToSearch')}
            </li>
          )}
          {options.map(o => (
            <li
              key={o.rid}
              role="option"
              aria-selected={o.rid === value}
              tabIndex={-1}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-panel-2',
                o.rid === value && 'text-cyan',
              )}
              onMouseDown={e => {
                e.preventDefault();
                setPicked(o);
                onChange(o.rid);
                setOpen(false);
              }}
            >
              <span className="truncate">{o.title}</span>
              {o.suggested ? (
                <span className="text-[10px] text-violet">
                  {t('picker.suggested')}
                </span>
              ) : (
                <span className="truncate font-mono text-[10px] text-dim">
                  {o.rid.split('.').slice(-1)[0]?.slice(-8)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
