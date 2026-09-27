/**
 * @fileoverview Perturbation panel of the scenario page (≤ 10 items, counter
 * 「2 / 10」): each item picks an object and one of its numeric properties
 * and sets either a relative change −100%..+100% (step 5%) with a slider,
 * or a 「延误时长」 in days on a time property (e.g. leadTimeDays), which is
 * converted to the relative change the API expects using the object's
 * current value; both are shown (「+3 天 ≈ +21%（当前 14 天）」).
 */

import {Plus, X} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ObjectRefInput} from '../../../entities/renderers/object_ref_input';
import {
  numericProperties,
  typeOfRid,
  type UiModel,
} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Button} from '../../../shared/ui/button';
import {Input} from '../../../shared/ui/input';
import {Segmented} from '../../../shared/ui/segmented';
import {NativeSelect} from '../../../shared/ui/select';
import {Slider} from '../../../shared/ui/slider';
import {
  canAddPerturbation,
  CHANGE_STEP_PCT,
  clampDelay,
  clampPct,
  DELAY_DAYS_MAX,
  delayProperties,
  delayToChange,
  newPerturbation,
  PERTURBATIONS_MAX,
  type CurrentValue,
  type PerturbationDraft,
  type PerturbationMode,
} from '../model';

function PerturbationItem({
  draft,
  index,
  model,
  title,
  current,
  onChange,
  onRemove,
}: {
  draft: PerturbationDraft;
  index: number;
  model: UiModel;
  title?: string;
  current?: CurrentValue;
  onChange(d: PerturbationDraft): void;
  onRemove(): void;
}) {
  const {t} = useTranslation('scenarios');
  const type = draft.rid ? model.byName[typeOfRid(draft.rid) ?? ''] : undefined;
  const numeric = numericProperties(type);
  const delay = draft.mode === 'delay';
  const props = delay ? delayProperties(numeric) : numeric;
  const prop = props.find(p => p.apiName === draft.property);
  const n = index + 1;
  const [delayText, setDelayText] = useState(String(draft.delayDays));
  const now = draft.property ? current?.(draft.rid, draft.property) : undefined;
  const converted = delay
    ? delayToChange(draft.delayDays, now, prop?.unit)
    : null;
  const setMode = (mode: PerturbationMode) => {
    const list = mode === 'delay' ? delayProperties(numeric) : numeric;
    const keep = list.some(p => p.apiName === draft.property);
    onChange({
      ...draft,
      mode,
      property: keep ? draft.property : (list[0]?.apiName ?? ''),
    });
  };
  return (
    <li
      data-testid="perturbation"
      className="flex flex-col gap-2 rounded-[12px] border border-line bg-panel-2 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-text">
          {title && prop
            ? `${title} · ${prop.displayName}`
            : t('perturb.item', {index: n})}
        </span>
        <span className="flex items-center gap-1">
          <span
            className={cn(
              'num text-sm font-semibold',
              delay
                ? draft.delayDays > 0
                  ? 'text-orange'
                  : 'text-muted'
                : draft.changePct < 0
                  ? 'text-orange'
                  : draft.changePct > 0
                    ? 'text-cyan'
                    : 'text-muted',
            )}
            data-testid="perturbation-value"
          >
            {delay
              ? t('perturb.delayValue', {days: draft.delayDays})
              : draft.changePct === 0
                ? '0%'
                : fmt.signedPercent(draft.changePct / 100, 0)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('perturb.remove', {index: n})}
            onClick={onRemove}
          >
            <X aria-hidden />
          </Button>
        </span>
      </div>
      <Segmented<PerturbationMode>
        size="sm"
        label={`${t('perturb.mode')} ${n}`}
        value={draft.mode}
        options={[
          {value: 'relative', label: t('perturb.change')},
          {value: 'delay', label: t('perturb.delay')},
        ]}
        onChange={setMode}
      />
      <ObjectRefInput
        label={`${t('perturb.object')} ${n}`}
        value={draft.rid}
        onChange={rid => {
          const tp = model.byName[typeOfRid(rid) ?? ''];
          const all = numericProperties(tp);
          const nums = delay ? delayProperties(all) : all;
          const keep = nums.some(p => p.apiName === draft.property);
          onChange({
            ...draft,
            rid,
            property: keep ? draft.property : (nums[0]?.apiName ?? ''),
          });
        }}
      />
      <NativeSelect
        size="sm"
        aria-label={`${t('perturb.property')} ${n}`}
        value={draft.property}
        disabled={!type || props.length === 0}
        placeholder={
          !type
            ? t('perturb.pickObjectFirst')
            : props.length
              ? t('perturb.pickProperty')
              : t('perturb.noNumeric')
        }
        options={props.map(p => ({
          value: p.apiName,
          label: p.unit ? `${p.displayName} (${p.unit})` : p.displayName,
        }))}
        onChange={e => onChange({...draft, property: e.target.value})}
      />
      {delay ? (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`delay-${draft.key}`}
            className="text-xs font-medium text-muted"
          >
            {t('perturb.delayDays')}
          </label>
          <Input
            id={`delay-${draft.key}`}
            type="number"
            inputMode="decimal"
            min={0}
            max={DELAY_DAYS_MAX}
            step={0.1}
            value={delayText}
            onChange={e => {
              setDelayText(e.target.value);
              const v = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(v))
                onChange({...draft, delayDays: clampDelay(v)});
            }}
            onBlur={() => setDelayText(String(draft.delayDays))}
          />
          <p className="text-xs text-muted" data-testid="delay-conversion">
            {!draft.property
              ? t('perturb.delayPickProperty')
              : converted
                ? t('perturb.delayConverted', {
                    days: draft.delayDays,
                    pct: fmt.signedPercent(converted.change, 0),
                    current: String(now),
                    unit: prop?.unit ?? '',
                  })
                : t('perturb.delayNoCurrent')}
          </p>
          {converted?.capped && (
            <p className="text-xs text-warn">{t('perturb.delayCapped')}</p>
          )}
        </div>
      ) : (
        <div>
          <Slider
            min={-100}
            max={100}
            step={CHANGE_STEP_PCT}
            value={[draft.changePct]}
            thumbLabel={t('perturb.sliderLabel', {index: n})}
            onValueChange={([v]) =>
              onChange({...draft, changePct: clampPct(v)})
            }
          />
          <div className="mt-1 flex justify-between text-[11px] text-dim num">
            <span>−100%</span>
            <span>0</span>
            <span>+100%</span>
          </div>
        </div>
      )}
    </li>
  );
}

/** Perturbation list with the add button (disabled at the limit). */
export function PerturbationEditor({
  drafts,
  onChange,
  model,
  titles,
  current,
}: {
  drafts: PerturbationDraft[];
  onChange(next: PerturbationDraft[]): void;
  model: UiModel;
  titles: Record<string, string>;
  /** Current property values of the perturbed objects (delay conversion). */
  current?: CurrentValue;
}) {
  const {t} = useTranslation('scenarios');
  const canAdd = canAddPerturbation(drafts);
  return (
    <section aria-labelledby="perturb-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="perturb-title" className="text-sm font-semibold text-text">
          {t('perturb.title')}
        </h2>
        <span
          className="num text-xs text-muted"
          data-testid="perturbation-count"
        >
          {t('perturb.count', {count: drafts.length, max: PERTURBATIONS_MAX})}
        </span>
      </div>
      {drafts.length === 0 && (
        <p className="text-xs text-dim">{t('perturb.empty')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {drafts.map((d, i) => (
          <PerturbationItem
            key={d.key}
            draft={d}
            index={i}
            model={model}
            title={titles[d.rid]}
            current={current}
            onChange={nd =>
              onChange(drafts.map(x => (x.key === d.key ? nd : x)))
            }
            onRemove={() => onChange(drafts.filter(x => x.key !== d.key))}
          />
        ))}
      </ul>
      <Button
        variant="outline"
        disabled={!canAdd}
        title={
          canAdd ? undefined : t('perturb.limit', {max: PERTURBATIONS_MAX})
        }
        onClick={() => onChange([...drafts, newPerturbation()])}
      >
        <Plus aria-hidden />
        {t('perturb.add')}
      </Button>
      {!canAdd && (
        <p className="text-xs text-warn">
          {t('perturb.limit', {max: PERTURBATIONS_MAX})}
        </p>
      )}
    </section>
  );
}
