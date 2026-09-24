/**
 * @fileoverview Chips (tag list) input: Enter / comma adds, Backspace on an
 * empty input removes the last chip. All strings come from props so the
 * component can be used from any namespace.
 */

import {X} from 'lucide-react';
import {useId, useState, type KeyboardEvent} from 'react';
import {cn} from '../../../shared/lib/cn';

/** Chips input props. */
export interface ChipsInputProps {
  value: readonly string[] | undefined;
  onChange(next: string[]): void;
  /** Accessible name of the text input. */
  label: string;
  /** Accessible name of a chip's remove button. */
  removeLabel(value: string): string;
  placeholder?: string;
  disabled?: boolean;
  /** Optional suggestions offered via a datalist. */
  suggestions?: readonly string[];
  /** Chip tone. */
  tone?: 'neutral' | 'cyan' | 'violet' | 'orange';
  size?: 'sm' | 'md';
  className?: string;
}

const TONES = {
  neutral: 'border-line-2 bg-panel-2 text-muted',
  cyan: 'border-cyan/40 bg-cyan/10 text-cyan',
  violet: 'border-violet/40 bg-violet/10 text-violet',
  orange: 'border-orange/40 bg-orange/10 text-orange',
};

/** A chips editor. */
export function ChipsInput({
  value,
  onChange,
  label,
  removeLabel,
  placeholder,
  disabled,
  suggestions,
  tone = 'neutral',
  size = 'md',
  className,
}: ChipsInputProps) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const chips = value ?? [];

  const commit = (raw: string) => {
    const parts = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !chips.includes(s));
    if (parts.length) onChange([...chips, ...Array.from(new Set(parts))]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && chips.length) {
      onChange(chips.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1 rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-1.5 focus-within:border-cyan',
        size === 'sm' ? 'min-h-7 py-0.5' : 'min-h-9 py-1',
        disabled && 'opacity-50',
        className,
      )}
    >
      {chips.map(c => (
        <span
          key={c}
          className={cn(
            'inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[11px] leading-4',
            TONES[tone],
          )}
        >
          {c}
          {!disabled && (
            <button
              type="button"
              className="rounded-full p-0.5 hover:text-text"
              aria-label={removeLabel(c)}
              onClick={() => onChange(chips.filter(x => x !== c))}
            >
              <X className="size-2.5" aria-hidden />
            </button>
          )}
        </span>
      ))}
      <input
        aria-label={label}
        className={cn(
          'min-w-16 flex-1 bg-transparent px-1 text-text outline-none placeholder:text-dim',
          size === 'sm' ? 'text-xs' : 'text-sm',
        )}
        value={draft}
        disabled={disabled}
        placeholder={chips.length ? undefined : placeholder}
        list={suggestions?.length ? listId : undefined}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && commit(draft)}
      />
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions
            .filter(s => !chips.includes(s))
            .map(s => (
              <option key={s} value={s} />
            ))}
        </datalist>
      ) : null}
    </div>
  );
}
