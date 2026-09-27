/**
 * @fileoverview Perturbation panel of the scenario page (≤ 10 items, counter
 * 「2 / 10」): each item picks an object and one of its numeric properties
 * and sets a relative change −100%..+100% (step 5%) with a slider.
 */

import {Plus, X} from 'lucide-react';
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
import {NativeSelect} from '../../../shared/ui/select';
import {Slider} from '../../../shared/ui/slider';
import {
  canAddPerturbation,
  CHANGE_STEP_PCT,
  clampPct,
  newPerturbation,
  PERTURBATIONS_MAX,
  type PerturbationDraft,
} from '../model';

function PerturbationItem({
  draft,
  index,
  model,
  title,
  onChange,
  onRemove,
}: {
  draft: PerturbationDraft;
  index: number;
  model: UiModel;
  title?: string;
  onChange(d: PerturbationDraft): void;
  onRemove(): void;
}) {
  const {t} = useTranslation('scenarios');
  const type = draft.rid ? model.byName[typeOfRid(draft.rid) ?? ''] : undefined;
  const props = numericProperties(type);
  const prop = props.find(p => p.apiName === draft.property);
  const n = index + 1;
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
              draft.changePct < 0
                ? 'text-orange'
                : draft.changePct > 0
                  ? 'text-cyan'
                  : 'text-muted',
            )}
            data-testid="perturbation-value"
          >
            {draft.changePct === 0
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
      <ObjectRefInput
        label={`${t('perturb.object')} ${n}`}
        value={draft.rid}
        onChange={rid => {
          const tp = model.byName[typeOfRid(rid) ?? ''];
          const nums = numericProperties(tp);
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
      <div>
        <Slider
          min={-100}
          max={100}
          step={CHANGE_STEP_PCT}
          value={[draft.changePct]}
          thumbLabel={t('perturb.sliderLabel', {index: n})}
          onValueChange={([v]) => onChange({...draft, changePct: clampPct(v)})}
        />
        <div className="mt-1 flex justify-between text-[11px] text-dim num">
          <span>−100%</span>
          <span>0</span>
          <span>+100%</span>
        </div>
      </div>
    </li>
  );
}

/** Perturbation list with the add button (disabled at the limit). */
export function PerturbationEditor({
  drafts,
  onChange,
  model,
  titles,
}: {
  drafts: PerturbationDraft[];
  onChange(next: PerturbationDraft[]): void;
  model: UiModel;
  titles: Record<string, string>;
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
