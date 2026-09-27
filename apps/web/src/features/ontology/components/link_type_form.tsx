/**
 * @fileoverview Link type form: api name, bilingual names, from / to object
 * types, cardinality and impact propagation (default weight 0..1).
 */

import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import {Field, Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Switch} from '../../../shared/ui/switch';
import type {LinkTypeForm} from '../model';
import {I18nInputs, type IssueMap, useIssueText} from './form_bits';

/** Link type form props. */
export interface LinkTypeFormProps {
  form: LinkTypeForm;
  onChange(next: LinkTypeForm): void;
  issues: IssueMap;
  isNew: boolean;
  /** Object types as select options. */
  typeOptions: {value: string; label: string}[];
}

/** The form. */
export function LinkTypeFormView({
  form,
  onChange,
  issues,
  isNew,
  typeOptions,
}: LinkTypeFormProps) {
  const {t} = useTranslation('ontology');
  const id = useId();
  const it = useIssueText();
  const apiErr = it(issues.get('apiName'));
  const fromErr = it(issues.get('from'));
  const toErr = it(issues.get('to'));
  const wErr = it(issues.get('propagation.defaultWeight'));
  return (
    <div className="flex flex-col gap-4">
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
      <I18nInputs
        label={t('field.displayName')}
        required
        value={form.displayName}
        issue={issues.get('displayName')}
        onChange={v => onChange({...form, displayName: v})}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label={t('link.from')}
          htmlFor={`${id}-from`}
          required
          error={fromErr}
        >
          <NativeSelect
            id={`${id}-from`}
            value={form.from}
            placeholder={t('field.chooseType')}
            options={typeOptions}
            aria-invalid={!!fromErr}
            onChange={e => onChange({...form, from: e.target.value})}
          />
        </Field>
        <Field label={t('link.to')} htmlFor={`${id}-to`} required error={toErr}>
          <NativeSelect
            id={`${id}-to`}
            value={form.to}
            placeholder={t('field.chooseType')}
            options={typeOptions}
            aria-invalid={!!toErr}
            onChange={e => onChange({...form, to: e.target.value})}
          />
        </Field>
        <Field label={t('link.cardinality')} htmlFor={`${id}-card`}>
          <NativeSelect
            id={`${id}-card`}
            value={form.cardinality}
            options={[
              {value: 'one', label: t('link.one')},
              {value: 'many', label: t('link.many')},
            ]}
            onChange={e =>
              onChange({...form, cardinality: e.target.value as 'one' | 'many'})
            }
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4 rounded-[10px] border border-line p-3">
        <label className="flex items-center gap-2 text-sm text-text">
          <Switch
            checked={form.propagates}
            aria-label={t('link.propagates')}
            onCheckedChange={v => onChange({...form, propagates: v})}
          />
          {t('link.propagates')}
        </label>
        {form.propagates && (
          <Field
            label={t('link.defaultWeight')}
            htmlFor={`${id}-w`}
            error={wErr}
            hint={t('link.defaultWeightHint')}
            className="w-48"
          >
            <Input
              id={`${id}-w`}
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="num"
              aria-invalid={!!wErr}
              value={form.defaultWeight}
              onChange={e => onChange({...form, defaultWeight: e.target.value})}
            />
          </Field>
        )}
      </div>
    </div>
  );
}
