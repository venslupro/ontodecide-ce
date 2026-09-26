/**
 * @fileoverview Link type editor: from / to object types, cardinality and
 * the impact propagation default weight (0..1).
 */

import {zodResolver} from '@hookform/resolvers/zod';
import {
  linkTypeDefSchema,
  type LinkTypeDef,
} from '@ontodecide/ontology/contract';
import {ArrowRight} from 'lucide-react';
import {useId} from 'react';
import {Controller, useForm, type Resolver} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {Checkbox, Field, Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Slider} from '../../../shared/ui/slider';
import {fieldError, I18nFields, useFormSync} from './form_fields';

/** Link type editor props. */
export interface LinkTypeEditorProps {
  value: LinkTypeDef;
  typeOptions: {value: string; label: string}[];
  onChange(value: LinkTypeDef): void;
}

/** Link type form. */
export function LinkTypeEditor({
  value,
  typeOptions,
  onChange,
}: LinkTypeEditorProps) {
  const {t} = useTranslation('ontology');
  const form = useForm<LinkTypeDef>({
    defaultValues: value,
    resolver: zodResolver(
      linkTypeDefSchema,
    ) as unknown as Resolver<LinkTypeDef>,
    mode: 'onChange',
  });
  useFormSync(form, onChange);
  const {control, register, formState} = form;
  const ids = {
    api: useId(),
    from: useId(),
    to: useId(),
    card: useId(),
    prop: useId(),
    weight: useId(),
  };
  const apiErr = fieldError(formState.errors, 'apiName');

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={e => e.preventDefault()}
      aria-label={t('link.formLabel')}
    >
      <Field
        label={t('fields.apiName')}
        htmlFor={ids.api}
        required
        error={apiErr && t('errors.apiName')}
        hint={t('fields.apiNameHint')}
      >
        <Input
          id={ids.api}
          className="font-mono"
          aria-invalid={!!apiErr}
          {...register('apiName')}
        />
      </Field>
      <I18nFields
        control={control}
        name="displayName"
        label={t('fields.displayName')}
        required
      />
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
        <Field label={t('link.from')} htmlFor={ids.from} required>
          <Controller
            control={control}
            name="from"
            render={({field}) => (
              <NativeSelect
                id={ids.from}
                options={typeOptions}
                placeholder={t('fields.choose')}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Field>
        <ArrowRight
          className="mb-2.5 hidden size-4 text-dim md:block"
          aria-hidden
        />
        <Field label={t('link.to')} htmlFor={ids.to} required>
          <Controller
            control={control}
            name="to"
            render={({field}) => (
              <NativeSelect
                id={ids.to}
                options={typeOptions}
                placeholder={t('fields.choose')}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Field>
      </div>
      <Field label={t('link.cardinality')} htmlFor={ids.card}>
        <Controller
          control={control}
          name="cardinality"
          render={({field}) => (
            <NativeSelect
              id={ids.card}
              options={[
                {value: 'one', label: t('link.one')},
                {value: 'many', label: t('link.many')},
              ]}
              value={field.value}
              onChange={e => field.onChange(e.target.value)}
            />
          )}
        />
      </Field>
      <Controller
        control={control}
        name="propagation"
        render={({field, fieldState}) => {
          const on = !!field.value;
          const w = field.value?.defaultWeight ?? 1;
          return (
            <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
              <legend className="px-1 text-xs font-medium text-muted">
                {t('link.propagation')}
              </legend>
              <span className="inline-flex items-center gap-2">
                <Checkbox
                  id={ids.prop}
                  checked={on}
                  onCheckedChange={v =>
                    field.onChange(v === true ? {defaultWeight: 1} : undefined)
                  }
                />
                <label htmlFor={ids.prop} className="text-sm text-text">
                  {t('link.propagationOn')}
                </label>
              </span>
              <p className="text-xs text-dim">{t('link.propagationHint')}</p>
              {on && (
                <div className="grid grid-cols-[1fr_6rem] items-center gap-3">
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[w]}
                    onValueChange={([v]) => field.onChange({defaultWeight: v})}
                    thumbLabel={t('link.defaultWeight')}
                  />
                  <Input
                    id={ids.weight}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    inputSize="sm"
                    className="num"
                    aria-label={t('link.defaultWeight')}
                    aria-invalid={!!fieldState.error}
                    value={Number.isFinite(w) ? w : ''}
                    onChange={e =>
                      field.onChange({defaultWeight: e.target.valueAsNumber})
                    }
                  />
                </div>
              )}
              {fieldState.error && (
                <p role="alert" className="text-xs text-crit">
                  {t('errors.weight')}
                </p>
              )}
            </fieldset>
          );
        }}
      />
    </form>
  );
}
