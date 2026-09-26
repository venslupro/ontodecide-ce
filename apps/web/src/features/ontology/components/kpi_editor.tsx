/**
 * @fileoverview Simulation KPI editor (object type, aggregation, property,
 * unit, direction) and the schema-level settings editor.
 */

import {zodResolver} from '@hookform/resolvers/zod';
import {
  schemaDefSchema,
  type ObjectTypeDef,
  type SchemaDef,
  type SimulationKpiDef,
} from '@ontodecide/ontology/contract';
import type {I18nText} from '@ontodecide/shared-kernel';
import {useId} from 'react';
import {Controller, useForm, useWatch, type Resolver} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {Field, Input} from '../../../shared/ui/input';
import {Mono} from '../../../shared/ui/page_header';
import {NativeSelect} from '../../../shared/ui/select';
import {fieldError, I18nFields, SwitchField, useFormSync} from './form_fields';

const kpiSchema = schemaDefSchema.shape.simulationKpis.unwrap().element;

/** KPI editor props. */
export interface KpiEditorProps {
  value: SimulationKpiDef;
  objectTypes: readonly ObjectTypeDef[];
  onChange(value: SimulationKpiDef): void;
}

/** Simulation KPI form. */
export function KpiEditor({value, objectTypes, onChange}: KpiEditorProps) {
  const {t} = useTranslation('ontology');
  const form = useForm<SimulationKpiDef>({
    defaultValues: value,
    resolver: zodResolver(kpiSchema) as unknown as Resolver<SimulationKpiDef>,
    mode: 'onChange',
  });
  useFormSync(form, onChange);
  const {control, register, formState} = form;
  const objectType = useWatch({control, name: 'objectType'});
  const agg = useWatch({control, name: 'agg'});
  const ids = {
    api: useId(),
    type: useId(),
    agg: useId(),
    prop: useId(),
    unit: useId(),
  };
  const numeric = (
    objectTypes.find(o => o.apiName === objectType)?.properties ?? []
  ).filter(p => ['integer', 'double'].includes(p.dataType));
  const apiErr = fieldError(formState.errors, 'apiName');

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={e => e.preventDefault()}
      aria-label={t('kpi.formLabel')}
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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={t('kpi.objectType')} htmlFor={ids.type} required>
          <Controller
            control={control}
            name="objectType"
            render={({field}) => (
              <NativeSelect
                id={ids.type}
                options={objectTypes.map(o => ({
                  value: o.apiName,
                  label: o.apiName,
                }))}
                placeholder={t('fields.choose')}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Field>
        <Field label={t('kpi.agg')} htmlFor={ids.agg}>
          <Controller
            control={control}
            name="agg"
            render={({field}) => (
              <NativeSelect
                id={ids.agg}
                options={(['sum', 'avg', 'count'] as const).map(a => ({
                  value: a,
                  label: t(`kpi.aggs.${a}`),
                }))}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Field>
        {agg !== 'count' && (
          <Field label={t('kpi.property')} htmlFor={ids.prop} required>
            <Controller
              control={control}
              name="property"
              render={({field}) => (
                <NativeSelect
                  id={ids.prop}
                  options={numeric.map(p => ({
                    value: p.apiName,
                    label: p.apiName,
                  }))}
                  placeholder={t('fields.choose')}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.target.value || undefined)}
                />
              )}
            />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t('prop.unit')} htmlFor={ids.unit}>
          <Input id={ids.unit} {...register('unit')} />
        </Field>
        <SwitchField
          control={control}
          name="higherIsBetter"
          label={t('kpi.higherIsBetter')}
          hint={t('kpi.higherIsBetterHint')}
        />
      </div>
    </form>
  );
}

/** Schema settings form value. */
interface SchemaMeta {
  displayName: I18nText;
  description?: I18nText;
}

/** Schema-level settings (display name / description) with a summary. */
export function SchemaMetaEditor({
  def,
  version,
  onChange,
}: {
  def: SchemaDef;
  version?: string;
  onChange(value: SchemaMeta): void;
}) {
  const {t} = useTranslation('ontology');
  const form = useForm<SchemaMeta>({
    defaultValues: {displayName: def.displayName, description: def.description},
  });
  useFormSync(form, onChange);
  const stats = [
    [t('tree.objectTypes'), def.objectTypes.length],
    [t('tree.linkTypes'), def.linkTypes.length],
    [t('tree.actionTypes'), def.actionTypes.length],
    [t('tree.kpis'), def.simulationKpis?.length ?? 0],
  ] as const;
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={e => e.preventDefault()}
      aria-label={t('schema.formLabel')}
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div
            key={k}
            className="rounded-lg border border-line bg-panel-2/50 px-3 py-2"
          >
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="num text-xl font-semibold text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="text-muted">
          {t('fields.apiName')}: <Mono>{def.apiName}</Mono>
        </span>
        <span className="text-muted">
          {t('schema.version')}:{' '}
          <Mono>{version ?? t('schema.unpublished')}</Mono>
        </span>
      </div>
      <I18nFields
        control={form.control}
        name="displayName"
        label={t('fields.displayName')}
        required
      />
      <I18nFields
        control={form.control}
        name="description"
        label={t('fields.description')}
        multiline
      />
    </form>
  );
}
