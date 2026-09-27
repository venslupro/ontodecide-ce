/**
 * @fileoverview Action type form: target type, parameters, preconditions
 * (JSONLogic over `{target, params}` + message), effects (set / increment /
 * relink / unlink) and impact hints used by the simulator. Actions only
 * change objects inside the workspace (no approval, no writeback in CE).
 */

import type {EffectDef, OntologyDef} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Plus, Trash2} from 'lucide-react';
import {useId, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from '../../../shared/ui/button';
import {Checkbox, Field, Input, Textarea} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {
  type ActionTypeForm,
  type EffectForm,
  newEffectForm,
  newImpactForm,
  newParamForm,
  newPreconditionForm,
} from '../model';
import {
  CellError,
  I18nInputs,
  type IssueMap,
  useDataTypeOptions,
  useIssueText,
} from './form_bits';

/** Action type form props. */
export interface ActionTypeFormProps {
  form: ActionTypeForm;
  onChange(next: ActionTypeForm): void;
  issues: IssueMap;
  isNew: boolean;
  /** The workspace ontology (target properties, link types). */
  ontology: OntologyDef;
  locale: string;
}

const EFFECT_KINDS: EffectDef['kind'][] = [
  'set',
  'increment',
  'relink',
  'unlink',
];

function Section({
  title,
  hint,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  hint?: string;
  onAdd(): void;
  addLabel: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={id} className="text-sm font-semibold text-text">
          {title}
        </h3>
        {hint && <span className="text-xs text-dim">{hint}</span>}
        <Button size="sm" variant="outline" className="ml-auto" onClick={onAdd}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}

function RemoveButton({label, onClick}: {label: string; onClick(): void}) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
      <Trash2 aria-hidden />
    </Button>
  );
}

/** The form. */
export function ActionTypeFormView({
  form,
  onChange,
  issues,
  isNew,
  ontology,
  locale,
}: ActionTypeFormProps) {
  const {t} = useTranslation('ontology');
  const id = useId();
  const it = useIssueText();
  const typeNames = ontology.objectTypes.map(o => o.apiName);
  const dataTypes = useDataTypeOptions(typeNames);
  const target = ontology.objectTypes.find(o => o.apiName === form.targetType);
  const propOptions = (target?.properties ?? []).map(p => ({
    value: p.apiName,
    label: resolveText(p.displayName, locale, p.apiName),
  }));
  const numericOptions = (target?.properties ?? [])
    .filter(p => p.dataType === 'integer' || p.dataType === 'double')
    .map(p => ({
      value: p.apiName,
      label: resolveText(p.displayName, locale, p.apiName),
    }));
  const linkOptions = ontology.linkTypes
    .filter(
      l => !target || l.from === target.apiName || l.to === target.apiName,
    )
    .map(l => ({
      value: l.apiName,
      label: resolveText(l.displayName, locale, l.apiName),
    }));
  const paramOptions = form.parameters
    .map(p => p.apiName)
    .filter(Boolean)
    .map(n => ({value: n, label: n}));
  const apiErr = it(issues.get('apiName'));
  const targetErr = it(issues.get('targetType'));

  function patchList<
    K extends 'parameters' | 'preconditions' | 'effects' | 'impact',
  >(key: K, i: number, patch: Partial<ActionTypeForm[K][number]>) {
    onChange({
      ...form,
      [key]: (form[key] as ActionTypeForm[K][number][]).map((x, j) =>
        j === i ? {...x, ...patch} : x,
      ),
    });
  }
  function removeAt(
    key: 'parameters' | 'preconditions' | 'effects' | 'impact',
    i: number,
  ) {
    onChange({
      ...form,
      [key]: (form[key] as unknown[]).filter((_, j) => j !== i),
    });
  }

  const effectFields = (e: EffectForm, i: number) => {
    const path = `effects.${i}`;
    const n = i + 1;
    if (e.kind === 'set' || e.kind === 'increment') {
      const vPath = `${path}.${e.kind === 'set' ? 'value' : 'by'}`;
      return (
        <>
          <div className="w-40">
            <NativeSelect
              size="sm"
              aria-label={t('action.effectProp', {n})}
              value={e.prop}
              placeholder={t('field.chooseProperty')}
              options={propOptions}
              onChange={ev => patchList('effects', i, {prop: ev.target.value})}
            />
            <CellError issue={issues.get(`${path}.prop`)} />
          </div>
          <div className="min-w-48 flex-1">
            <Input
              inputSize="sm"
              className="font-mono"
              aria-label={
                e.kind === 'set'
                  ? t('action.effectValue', {n})
                  : t('action.effectBy', {n})
              }
              placeholder={t('action.jsonHint')}
              value={e.valueText}
              onChange={ev =>
                patchList('effects', i, {valueText: ev.target.value})
              }
            />
            <CellError issue={issues.get(vPath)} />
          </div>
        </>
      );
    }
    return (
      <>
        <div className="w-40">
          <NativeSelect
            size="sm"
            aria-label={t('action.effectLink', {n})}
            value={e.link}
            placeholder={t('action.chooseLink')}
            options={linkOptions}
            onChange={ev => patchList('effects', i, {link: ev.target.value})}
          />
          <CellError issue={issues.get(`${path}.link`)} />
        </div>
        <NativeSelect
          size="sm"
          className="w-28"
          aria-label={t('action.effectDirection', {n})}
          value={e.direction}
          options={[
            {value: 'out', label: t('action.out')},
            {value: 'in', label: t('action.in')},
          ]}
          onChange={ev =>
            patchList('effects', i, {
              direction: ev.target.value as 'in' | 'out',
            })
          }
        />
        <div className="w-40">
          <NativeSelect
            size="sm"
            aria-label={t('action.effectParam', {n})}
            value={e.toParam}
            placeholder={
              e.kind === 'unlink'
                ? t('action.anyParam')
                : t('action.chooseParam')
            }
            options={paramOptions}
            onChange={ev => patchList('effects', i, {toParam: ev.target.value})}
          />
          <CellError issue={issues.get(`${path}.toParam`)} />
        </div>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={t('field.apiName')}
          htmlFor={`${id}-api`}
          required
          error={apiErr}
          hint={isNew ? t('field.apiNameHint') : t('field.apiNameFixed')}
        >
          <Input
            id={`${id}-api`}
            className="font-mono"
            value={form.apiName}
            disabled={!isNew}
            aria-invalid={!!apiErr}
            onChange={e => onChange({...form, apiName: e.target.value})}
          />
        </Field>
        <Field
          label={t('action.targetType')}
          htmlFor={`${id}-target`}
          required
          error={targetErr}
        >
          <NativeSelect
            id={`${id}-target`}
            value={form.targetType}
            placeholder={t('field.chooseType')}
            aria-invalid={!!targetErr}
            options={ontology.objectTypes.map(o => ({
              value: o.apiName,
              label: resolveText(o.displayName, locale, o.apiName),
            }))}
            onChange={e => onChange({...form, targetType: e.target.value})}
          />
        </Field>
      </div>
      <I18nInputs
        label={t('field.displayName')}
        required
        value={form.displayName}
        issue={issues.get('displayName')}
        onChange={v => onChange({...form, displayName: v})}
      />

      <Section
        title={t('action.parameters')}
        addLabel={t('action.addParam')}
        onAdd={() =>
          onChange({...form, parameters: [...form.parameters, newParamForm()]})
        }
      >
        {form.parameters.length === 0 && (
          <p className="text-xs text-dim">{t('action.noParams')}</p>
        )}
        {form.parameters.map((p, i) => {
          const path = `parameters.${i}`;
          const n = i + 1;
          return (
            <div key={p.key} className="flex flex-wrap items-start gap-2">
              <div className="w-36">
                <Input
                  inputSize="sm"
                  className="font-mono"
                  aria-label={t('action.paramApiName', {n})}
                  value={p.apiName}
                  onChange={e =>
                    patchList('parameters', i, {apiName: e.target.value})
                  }
                />
                <CellError issue={issues.get(`${path}.apiName`)} />
              </div>
              <div className="w-32">
                <Input
                  inputSize="sm"
                  aria-label={t('action.paramZh', {n})}
                  value={p.displayName.zh}
                  onChange={e =>
                    patchList('parameters', i, {
                      displayName: {...p.displayName, zh: e.target.value},
                    })
                  }
                />
                <CellError issue={issues.get(`${path}.displayName`)} />
              </div>
              <Input
                inputSize="sm"
                className="w-32"
                aria-label={t('action.paramEn', {n})}
                value={p.displayName.en}
                onChange={e =>
                  patchList('parameters', i, {
                    displayName: {...p.displayName, en: e.target.value},
                  })
                }
              />
              <div className="w-40">
                <NativeSelect
                  size="sm"
                  aria-label={t('action.paramType', {n})}
                  value={p.dataType}
                  options={dataTypes}
                  onChange={e =>
                    patchList('parameters', i, {dataType: e.target.value})
                  }
                />
                <CellError issue={issues.get(`${path}.dataType`)} />
              </div>
              <label className="flex h-7 items-center gap-1.5 text-xs text-muted">
                <Checkbox
                  aria-label={t('action.paramRequired', {n})}
                  checked={p.required}
                  onCheckedChange={v =>
                    patchList('parameters', i, {required: v === true})
                  }
                />
                {t('prop.required')}
              </label>
              <RemoveButton
                label={t('action.removeParam', {n})}
                onClick={() => removeAt('parameters', i)}
              />
            </div>
          );
        })}
      </Section>

      <Section
        title={t('action.preconditions')}
        hint={t('action.preconditionsHint')}
        addLabel={t('action.addPrecondition')}
        onAdd={() =>
          onChange({
            ...form,
            preconditions: [...form.preconditions, newPreconditionForm()],
          })
        }
      >
        {form.preconditions.map((pc, i) => {
          const path = `preconditions.${i}`;
          const n = i + 1;
          return (
            <div
              key={pc.key}
              className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Textarea
                    rows={2}
                    className="min-h-14 font-mono text-xs"
                    aria-label={t('action.preconditionExpr', {n})}
                    placeholder={t('action.jsonLogicHint')}
                    value={pc.exprText}
                    onChange={e =>
                      patchList('preconditions', i, {exprText: e.target.value})
                    }
                  />
                  <CellError issue={issues.get(`${path}.expr`)} />
                </div>
                <RemoveButton
                  label={t('action.removePrecondition', {n})}
                  onClick={() => removeAt('preconditions', i)}
                />
              </div>
              <I18nInputs
                size="sm"
                label={t('action.preconditionMessage', {n})}
                required
                value={pc.message}
                issue={issues.get(`${path}.message`)}
                onChange={v => patchList('preconditions', i, {message: v})}
              />
            </div>
          );
        })}
      </Section>

      <Section
        title={t('action.effects')}
        addLabel={t('action.addEffect')}
        onAdd={() =>
          onChange({...form, effects: [...form.effects, newEffectForm()]})
        }
      >
        {form.effects.map((e, i) => (
          <div key={e.key} className="flex flex-wrap items-start gap-2">
            <NativeSelect
              size="sm"
              className="w-32"
              aria-label={t('action.effectKind', {n: i + 1})}
              value={e.kind}
              options={EFFECT_KINDS.map(k => ({
                value: k,
                label: t(`action.kind.${k}`),
              }))}
              onChange={ev =>
                patchList('effects', i, {
                  kind: ev.target.value as EffectDef['kind'],
                })
              }
            />
            {effectFields(e, i)}
            <RemoveButton
              label={t('action.removeEffect', {n: i + 1})}
              onClick={() => removeAt('effects', i)}
            />
          </div>
        ))}
      </Section>

      <Section
        title={t('action.impact')}
        hint={t('action.impactHint')}
        addLabel={t('action.addImpact')}
        onAdd={() =>
          onChange({...form, impact: [...form.impact, newImpactForm()]})
        }
      >
        {form.impact.map((h, i) => {
          const n = i + 1;
          return (
            <div key={h.key} className="flex flex-wrap items-start gap-2">
              <div className="w-44">
                <NativeSelect
                  size="sm"
                  aria-label={t('action.impactProp', {n})}
                  value={h.property}
                  placeholder={t('field.chooseProperty')}
                  options={numericOptions}
                  onChange={e =>
                    patchList('impact', i, {property: e.target.value})
                  }
                />
                <CellError issue={issues.get(`impact.${i}.property`)} />
              </div>
              <div className="w-28">
                <Input
                  inputSize="sm"
                  type="number"
                  min={-1}
                  max={1}
                  step={0.05}
                  className="num"
                  aria-label={t('action.impactChange', {n})}
                  value={h.change}
                  onChange={e =>
                    patchList('impact', i, {change: e.target.value})
                  }
                />
                <CellError issue={issues.get(`impact.${i}.change`)} />
              </div>
              <RemoveButton
                label={t('action.removeImpact', {n})}
                onClick={() => removeAt('impact', i)}
              />
            </div>
          );
        })}
      </Section>
    </div>
  );
}
