/**
 * @fileoverview Perturbation panel: up to 10 rows of object + numeric
 * property + relative change (−100 %..+100 %, slider in 5 % steps plus a
 * numeric input).
 */

import {DECISION_LIMITS} from '@ontodecide/decision/contract';
import {parseRid} from '@ontodecide/shared-kernel';
import {Plus, Trash2} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import type {UiModel, UiProperty} from '../../../entities/schema/model';
import {ObjectRefInput} from '../../../entities/renderers/object_ref_input';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Button} from '../../../shared/ui/button';
import {Input, Label} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Slider} from '../../../shared/ui/slider';
import {
  looksLikeRid,
  newPerturbationDraft,
  type PerturbationDraft,
  snapChange,
} from '../model';
import {ObjectLink} from './object_link';

/** Numeric, visible properties of the object type encoded in a RID. */
export function numericProps(model: UiModel, rid: string): UiProperty[] {
  const type = parseRid(rid)?.objectType;
  const t = type ? model.byName[type] : undefined;
  return (t?.properties ?? []).filter(
    p => p.visible && (p.dataType === 'double' || p.dataType === 'integer'),
  );
}

/**
 * Integer percent input (−100..100) keeping the raw text while typing, so
 * intermediate states like "-" are not clobbered.
 */
function PercentInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
  label,
}: {
  id: string;
  value: number;
  onChange(v: number): void;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(prev => (Number(prev) === value ? prev : String(value)));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={-100}
      max={100}
      step={5}
      inputSize="sm"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-label={label}
      className="pr-6 text-right num"
      value={text}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        const v = Number(raw);
        if (raw.trim() !== '' && Number.isFinite(v))
          onChange(Math.max(-100, Math.min(100, v)));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

/** Per-row validation messages (keyed by row key). */
export type PerturbationErrors = Record<
  string,
  {rid?: string; property?: string; change?: string}
>;

function Row({
  row,
  index,
  errors,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  row: PerturbationDraft;
  index: number;
  errors?: PerturbationErrors[string];
  disabled?: boolean;
  canRemove: boolean;
  onChange(next: PerturbationDraft): void;
  onRemove(): void;
}) {
  const {t} = useTranslation('scenarios');
  const {model} = useUiModel();
  const props = numericProps(model, row.rid);
  const pct = Math.round(row.change * 100);
  const n = index + 1;
  const ids = {
    obj: `pt-${row.key}-obj`,
    prop: `pt-${row.key}-prop`,
    pct: `pt-${row.key}-pct`,
  };

  return (
    <li className="rounded-[10px] border border-line bg-panel-2/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">
          {t('perturbation.row', {n})}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onRemove}
          disabled={disabled || !canRemove}
          aria-label={t('perturbation.remove', {n})}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.obj}>{t('perturbation.object')}</Label>
          <ObjectRefInput
            id={ids.obj}
            value={row.rid}
            label={t('perturbation.objectAria', {n})}
            invalid={!!errors?.rid}
            disabled={disabled}
            onChange={rid => {
              const next = numericProps(model, rid);
              const keep = next.some(p => p.apiName === row.property);
              onChange({
                ...row,
                rid,
                property: keep ? row.property : (next[0]?.apiName ?? ''),
              });
            }}
          />
          {errors?.rid ? (
            <p role="alert" className="text-xs text-crit">
              {errors.rid}
            </p>
          ) : (
            looksLikeRid(row.rid) && (
              <p className="truncate text-xs text-dim">
                {t('perturbation.selected')} <ObjectLink rid={row.rid} />
              </p>
            )
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.prop}>{t('perturbation.property')}</Label>
          <NativeSelect
            id={ids.prop}
            aria-label={t('perturbation.propertyAria', {n})}
            aria-invalid={!!errors?.property || undefined}
            disabled={disabled || props.length === 0}
            value={row.property}
            onChange={e => onChange({...row, property: e.target.value})}
            placeholder={
              row.rid
                ? t('perturbation.chooseProperty')
                : t('perturbation.pickObjectFirst')
            }
            options={props.map(p => ({
              value: p.apiName,
              label: p.unit ? `${p.displayName} (${p.unit})` : p.displayName,
            }))}
          />
          {errors?.property && (
            <p role="alert" className="text-xs text-crit">
              {errors.property}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={ids.pct}>{t('perturbation.change')}</Label>
          <span
            className={cn(
              'text-sm font-semibold num',
              pct < 0 ? 'text-crit' : pct > 0 ? 'text-good' : 'text-muted',
            )}
            aria-hidden
          >
            {fmt.signedPercent(row.change, 0)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Slider
            min={-100}
            max={100}
            step={5}
            value={[pct]}
            disabled={disabled}
            onValueChange={([v]) =>
              onChange({...row, change: snapChange(v / 100)})
            }
            thumbLabel={t('perturbation.sliderAria', {
              n,
              value: fmt.signedPercent(row.change, 0),
            })}
            className="flex-1"
          />
          <div className="relative w-24 shrink-0">
            <PercentInput
              id={ids.pct}
              value={pct}
              disabled={disabled}
              invalid={!!errors?.change}
              label={t('perturbation.percentAria', {n})}
              onChange={v => onChange({...row, change: v / 100})}
            />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-dim">
              %
            </span>
          </div>
        </div>
        {errors?.change && (
          <p role="alert" className="text-xs text-crit">
            {errors.change}
          </p>
        )}
      </div>
    </li>
  );
}

/** Perturbation rows editor. */
export function PerturbationEditor({
  rows,
  onChange,
  errors,
  disabled,
}: {
  rows: PerturbationDraft[];
  onChange(rows: PerturbationDraft[]): void;
  errors?: PerturbationErrors;
  disabled?: boolean;
}) {
  const {t} = useTranslation('scenarios');
  const max = DECISION_LIMITS.perturbationsMax;
  return (
    <div className="flex flex-col gap-2.5">
      <ol
        className="flex flex-col gap-2.5"
        aria-label={t('perturbation.title')}
      >
        {rows.map((r, i) => (
          <Row
            key={r.key}
            row={r}
            index={i}
            errors={errors?.[r.key]}
            disabled={disabled}
            canRemove={rows.length > 1}
            onChange={next =>
              onChange(rows.map(x => (x.key === r.key ? next : x)))
            }
            onRemove={() => onChange(rows.filter(x => x.key !== r.key))}
          />
        ))}
      </ol>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || rows.length >= max}
          onClick={() => onChange([...rows, newPerturbationDraft()])}
        >
          <Plus aria-hidden />
          {t('perturbation.add')}
        </Button>
        <span className="text-xs text-dim num">
          {t('perturbation.count', {count: rows.length, max})}
        </span>
      </div>
    </div>
  );
}
