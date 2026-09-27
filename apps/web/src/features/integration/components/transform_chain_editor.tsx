/**
 * @fileoverview Transform chain input (`trim|toNumber|clamp(0,100)`, ≤ 5
 * steps) with autocomplete of the built-in steps and live validation by
 * the client mirror of the server chain parser.
 */

import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import {Input} from '../../../shared/ui/input';
import {TRANSFORMS, validateChain} from '../transform';

/** `<datalist>` id shared by every chain input on the page. */
export const TRANSFORM_DATALIST_ID = 'od-transform-options';

/** The shared datalist with every built-in transform. */
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

/** Chain input. */
export function TransformChainEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const {t} = useTranslation('imports');
  const errorId = useId();
  const err = validateChain(value);
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <Input
        inputSize="sm"
        value={value}
        onChange={e => onChange(e.target.value)}
        list={TRANSFORM_DATALIST_ID}
        aria-label={label}
        aria-invalid={!!err}
        aria-describedby={err ? errorId : undefined}
        placeholder="trim|toNumber"
        className="font-mono"
        spellCheck={false}
      />
      {err && (
        <p id={errorId} className="text-[11px] text-crit">
          {t('mapping.chainError', {step: err.step})}
        </p>
      )}
    </div>
  );
}
