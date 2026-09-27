/**
 * @fileoverview Candidate actions from the ontology (「候选动作（来自本体）」):
 * a checkbox list "action → target" for action types whose target type
 * matches a perturbed or impacted object. Checked actions show a minimal
 * parameter form (ontology defaults, renderer registry inputs).
 */

import {useId} from 'react';
import type {ControllerRenderProps} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {getRenderer} from '../../../entities/renderers/registry';
import {Checkbox, Label} from '../../../shared/ui/input';
import {
  CANDIDATE_ACTIONS_MAX,
  type CandidateOption,
  type CandidateSelection,
  defaultParams,
} from '../model';

type Field = ControllerRenderProps<Record<string, unknown>, string>;

function fieldOf(
  name: string,
  value: unknown,
  onChange: (v: unknown) => void,
): Field {
  return {
    name,
    value,
    onChange,
    onBlur: () => {},
    ref: () => {},
    disabled: false,
  } as unknown as Field;
}

function ParamsForm({
  option,
  params,
  onChange,
}: {
  option: CandidateOption;
  params: Record<string, unknown>;
  onChange(p: Record<string, unknown>): void;
}) {
  const {t} = useTranslation('scenarios');
  const base = useId();
  if (!option.action.parameters.length) return null;
  return (
    <div className="mt-2 ml-6 flex flex-col gap-2 border-l border-line pl-3">
      {option.action.parameters.map(p => {
        const id = `${base}-${p.apiName}`;
        return (
          <div key={p.apiName} className="flex flex-col gap-1">
            <Label htmlFor={id} className="text-xs text-muted">
              {p.displayName}
            </Label>
            {getRenderer(p.dataType).input(
              {
                apiName: p.apiName,
                displayName: p.displayName,
                dataType: p.dataType,
                required: p.required,
              },
              fieldOf(p.apiName, params[p.apiName] ?? null, v =>
                onChange({...params, [p.apiName]: v}),
              ),
              {id},
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-dim">{t('candidates.paramsHint')}</p>
    </div>
  );
}

/** Candidate action checkbox list. */
export function CandidateList({
  options,
  selection,
  onChange,
}: {
  options: CandidateOption[];
  selection: CandidateSelection;
  onChange(next: CandidateSelection): void;
}) {
  const {t} = useTranslation('scenarios');
  const base = useId();
  const count = Object.keys(selection).length;
  const full = count >= CANDIDATE_ACTIONS_MAX;
  return (
    <section aria-labelledby={`${base}-title`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id={`${base}-title`} className="text-sm font-semibold text-text">
          {t('candidates.title')}
        </h2>
        {options.length > 0 && (
          <span className="num text-xs text-muted">
            {t('candidates.selected', {count, max: CANDIDATE_ACTIONS_MAX})}
          </span>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-dim">{t('candidates.empty')}</p>
      ) : (
        <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto">
          {options.map(o => {
            const id = `${base}-${o.key}`;
            const checked = !!selection[o.key];
            return (
              <li key={o.key} className="py-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={!checked && full}
                    onCheckedChange={c => {
                      const next = {...selection};
                      if (c === true) next[o.key] = defaultParams(o.action);
                      else delete next[o.key];
                      onChange(next);
                    }}
                  />
                  <Label htmlFor={id} className="text-sm text-text">
                    {t('candidates.option', {
                      action: o.displayName,
                      target: o.targetTitle,
                    })}
                  </Label>
                </div>
                {checked && (
                  <ParamsForm
                    option={o}
                    params={selection[o.key]}
                    onChange={p => onChange({...selection, [o.key]: p})}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
