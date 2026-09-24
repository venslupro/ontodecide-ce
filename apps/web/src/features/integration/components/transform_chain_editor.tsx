/**
 * @fileoverview Transform chain editor: steps as removable chips plus an
 * input with autocomplete to append a step (≤ 5), or a raw text mode for
 * the whole `trim|toNumber|clamp(0,100)` expression. Validated live with
 * the client mirror of the server chain parser.
 */

import {INGEST_LIMITS} from '@ontodecide/integration/contract';
import {Code2, ListPlus, X} from 'lucide-react';
import {useId, useState, type KeyboardEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {Input} from '../../../shared/ui/input';
import {chainSteps, joinSteps, TRANSFORMS, validateChain} from '../transform';

/** `<datalist>` id shared by every chain editor on the page. */
export const TRANSFORM_DATALIST_ID = 'od-transform-options';

/** Renders the shared datalist with every built-in transform. */
export function TransformDatalist() {
  return (
    <datalist id={TRANSFORM_DATALIST_ID}>
      {TRANSFORMS.map(tr => (
        <option
          key={tr.name}
          value={tr.args ? `${tr.name}(${tr.args})` : tr.name}
        />
      ))}
    </datalist>
  );
}

/** Localized message of a chain's syntax error (null when valid). */
export function useChainError(value: string): string | null {
  const {t} = useTranslation('sources');
  const err = validateChain(value);
  if (!err) return null;
  return t(`mapping.chain.err.${err.code}`, {
    step: err.step,
    max: INGEST_LIMITS.transformChainMax,
  });
}

/** Chain editor. */
export function TransformChainEditor({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const {t} = useTranslation('sources');
  const [draft, setDraft] = useState('');
  const [textMode, setTextMode] = useState(false);
  const errorId = useId();
  const steps = chainSteps(value);
  const error = useChainError(value);
  const syntax = validateChain(value);
  const full = steps.length >= INGEST_LIMITS.transformChainMax;

  const add = () => {
    const s = draft.trim();
    if (!s || full) return;
    onChange(joinSteps([...steps, s]));
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && draft === '' && steps.length > 0) {
      onChange(joinSteps(steps.slice(0, -1)));
    }
  };

  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-col gap-1"
    >
      <div className="flex min-w-0 items-start gap-1">
        {textMode ? (
          <Input
            inputSize="sm"
            value={value}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            aria-label={t('mapping.chain.text', {field: label})}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            placeholder="trim|toNumber|clamp(0,100)"
            className="font-mono"
          />
        ) : (
          <div
            className={cn(
              'flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-1 py-0.5',
              error && 'border-crit',
            )}
          >
            {steps.map((s, i) => {
              const bad = syntax && syntax.step === s;
              return (
                <span
                  key={`${s}-${i}`}
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-md border px-1.5 font-mono text-[11px] leading-5',
                    bad
                      ? 'border-crit/50 bg-crit/10 text-crit'
                      : 'border-cyan/30 bg-cyan/10 text-cyan',
                  )}
                >
                  {i > 0 && <span className="sr-only">|</span>}
                  {s}
                  {!disabled && (
                    <button
                      type="button"
                      className="rounded text-muted hover:text-text"
                      aria-label={t('mapping.chain.removeStep', {step: s})}
                      onClick={() =>
                        onChange(joinSteps(steps.filter((_, j) => j !== i)))
                      }
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  )}
                </span>
              );
            })}
            {!full && !disabled && (
              <input
                list={TRANSFORM_DATALIST_ID}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKey}
                onBlur={add}
                aria-label={t('mapping.chain.addStep', {field: label})}
                placeholder={
                  steps.length === 0 ? t('mapping.chain.placeholder') : '+'
                }
                className="h-5 min-w-16 flex-1 bg-transparent font-mono text-[11px] text-text outline-none placeholder:text-dim"
              />
            )}
          </div>
        )}
        <button
          type="button"
          className="mt-0.5 rounded p-1 text-dim hover:bg-panel-2 hover:text-text"
          onClick={() => setTextMode(m => !m)}
          aria-pressed={textMode}
          aria-label={
            textMode
              ? t('mapping.chain.chipsMode')
              : t('mapping.chain.textMode')
          }
          title={
            textMode
              ? t('mapping.chain.chipsMode')
              : t('mapping.chain.textMode')
          }
          disabled={disabled}
        >
          {textMode ? (
            <ListPlus className="size-3.5" aria-hidden />
          ) : (
            <Code2 className="size-3.5" aria-hidden />
          )}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-[11px] text-crit">
          {error}
        </p>
      )}
    </div>
  );
}
