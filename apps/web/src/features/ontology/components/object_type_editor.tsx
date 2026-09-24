/**
 * @fileoverview Object type editor: basics (api name, bilingual names, icon,
 * primary key / title property, graph projection) and the properties table
 * (data type incl. `objectRef:<Type>`, flags, unit, enum values, markings,
 * semantic tags).
 */

import {zodResolver} from '@hookform/resolvers/zod';
import {
  objectTypeDefSchema,
  type ObjectTypeDef,
  type PropertyDef,
} from '@ontodecide/ontology/contract';
import {ChevronDown, ChevronRight, Plus, Trash2} from 'lucide-react';
import {Fragment, useId, useState} from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type Resolver,
} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Field, Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {newProperty, SCALAR_DATA_TYPES} from '../model';
import {ChipsInput} from './chips_input';
import {
  CheckField,
  fieldError,
  I18nFields,
  SwitchField,
  useFormSync,
} from './form_fields';

/** Data type options (scalars + one `objectRef:<Type>` per object type). */
export function dataTypeOptions(
  typeNames: readonly string[],
  t: (k: string, o?: Record<string, unknown>) => string,
) {
  return [
    ...SCALAR_DATA_TYPES.map(d => ({value: d, label: t(`dataType.${d}`)})),
    ...typeNames.map(n => ({
      value: `objectRef:${n}`,
      label: t('dataType.objectRef', {type: n}),
    })),
  ];
}

function PropertyRow({
  control,
  index,
  typeNames,
  onRemove,
  canRemove,
}: {
  control: Control<ObjectTypeDef>;
  index: number;
  typeNames: readonly string[];
  onRemove(): void;
  canRemove: boolean;
}) {
  const {t} = useTranslation('ontology');
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const prop = useWatch({control, name: `properties.${index}`}) as
    PropertyDef | undefined;
  const name = prop?.apiName || `#${index + 1}`;
  const path = `properties.${index}` as const;
  const extras =
    (prop?.markings?.length ?? 0) +
    (prop?.semanticTags?.length ?? 0) +
    (prop?.unit ? 1 : 0);
  return (
    <Fragment>
      <Tr className="align-top">
        <Td className="w-8 px-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={t('prop.details', {name})}
            onClick={() => setOpen(o => !o)}
          >
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          </Button>
        </Td>
        <Td className="min-w-32 px-1.5">
          <Controller
            control={control}
            name={`${path}.apiName`}
            render={({field, fieldState}) => (
              <>
                <Input
                  inputSize="sm"
                  className="font-mono"
                  aria-label={t('prop.apiNameAria', {n: index + 1})}
                  aria-invalid={!!fieldState.error}
                  {...field}
                  value={field.value ?? ''}
                />
                {fieldState.error && (
                  <p className="mt-0.5 text-[11px] text-crit">
                    {t('errors.apiName')}
                  </p>
                )}
              </>
            )}
          />
        </Td>
        <Td className="min-w-28 px-1.5">
          <Controller
            control={control}
            name={`${path}.displayName.zh-CN` as `properties.${number}.apiName`}
            render={({field}) => (
              <Input
                inputSize="sm"
                aria-label={t('prop.zhAria', {name})}
                {...field}
                value={field.value ?? ''}
              />
            )}
          />
        </Td>
        <Td className="min-w-28 px-1.5">
          <Controller
            control={control}
            name={`${path}.displayName.en-US` as `properties.${number}.apiName`}
            render={({field}) => (
              <Input
                inputSize="sm"
                aria-label={t('prop.enAria', {name})}
                {...field}
                value={field.value ?? ''}
              />
            )}
          />
        </Td>
        <Td className="min-w-32 px-1.5">
          <Controller
            control={control}
            name={`${path}.dataType`}
            render={({field}) => (
              <NativeSelect
                size="sm"
                aria-label={t('prop.dataTypeAria', {name})}
                options={dataTypeOptions(typeNames, t)}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Td>
        <Td className="px-1.5 text-center">
          <CheckField
            control={control}
            name={`${path}.required`}
            label={t('prop.requiredAria', {name})}
          />
        </Td>
        <Td className="px-1.5 text-center">
          <CheckField
            control={control}
            name={`${path}.indexed`}
            label={t('prop.indexedAria', {name})}
          />
        </Td>
        <Td className="px-1.5 text-center">
          <CheckField
            control={control}
            name={`${path}.sensitive`}
            label={t('prop.sensitiveAria', {name})}
          />
        </Td>
        <Td className="px-1.5">
          <div className="flex items-center justify-end gap-1">
            {extras > 0 && !open && <Badge tone="neutral">+{extras}</Badge>}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('prop.remove', {name})}
              title={
                canRemove ? t('prop.remove', {name}) : t('prop.lastProperty')
              }
              disabled={!canRemove}
              onClick={onRemove}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </Td>
      </Tr>
      {open && (
        <tr id={detailId} className="border-b border-line bg-panel-2/40">
          <td />
          <td colSpan={8} className="px-1.5 py-2.5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Controller
                control={control}
                name={`${path}.unit`}
                render={({field}) => (
                  <Field label={t('prop.unit')}>
                    <Input
                      inputSize="sm"
                      aria-label={t('prop.unitAria', {name})}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </Field>
                )}
              />
              {prop?.dataType === 'enum' && (
                <Controller
                  control={control}
                  name={`${path}.enumValues`}
                  render={({field}) => (
                    <Field label={t('prop.enumValues')}>
                      <ChipsInput
                        size="sm"
                        tone="cyan"
                        value={field.value}
                        onChange={field.onChange}
                        label={t('prop.enumValuesAria', {name})}
                        removeLabel={v => t('chips.remove', {value: v})}
                        placeholder={t('chips.placeholder')}
                      />
                    </Field>
                  )}
                />
              )}
              <Controller
                control={control}
                name={`${path}.markings`}
                render={({field}) => (
                  <Field
                    label={t('prop.markings')}
                    hint={t('prop.markingsHint')}
                  >
                    <ChipsInput
                      size="sm"
                      tone="orange"
                      value={field.value}
                      onChange={field.onChange}
                      label={t('prop.markingsAria', {name})}
                      removeLabel={v => t('chips.remove', {value: v})}
                      placeholder={t('chips.placeholder')}
                    />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name={`${path}.semanticTags`}
                render={({field}) => (
                  <Field
                    label={t('prop.semanticTags')}
                    hint={t('prop.semanticTagsHint')}
                  >
                    <ChipsInput
                      size="sm"
                      tone="violet"
                      value={field.value}
                      onChange={field.onChange}
                      label={t('prop.semanticTagsAria', {name})}
                      removeLabel={v => t('chips.remove', {value: v})}
                      placeholder={t('chips.placeholder')}
                      suggestions={[
                        'risk',
                        'capacity',
                        'demand',
                        'inventory',
                        'cost',
                        'geo',
                      ]}
                    />
                  </Field>
                )}
              />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Object type editor props. */
export interface ObjectTypeEditorProps {
  value: ObjectTypeDef;
  /** Api names of all object types in the schema (for `objectRef:*`). */
  typeNames: readonly string[];
  onChange(value: ObjectTypeDef): void;
}

/** Object type form. */
export function ObjectTypeEditor({
  value,
  typeNames,
  onChange,
}: ObjectTypeEditorProps) {
  const {t} = useTranslation('ontology');
  const form = useForm<ObjectTypeDef>({
    defaultValues: value,
    resolver: zodResolver(
      objectTypeDefSchema,
    ) as unknown as Resolver<ObjectTypeDef>,
    mode: 'onChange',
  });
  useFormSync(form, onChange);
  const {control, register, formState} = form;
  const props = useFieldArray({control, name: 'properties'});
  const watched = useWatch({control, name: 'properties'}) ?? [];
  const propOptions = watched.map(p => ({value: p.apiName, label: p.apiName}));
  const ids = {api: useId(), icon: useId(), pk: useId(), title: useId()};
  const apiErr = fieldError(formState.errors, 'apiName');

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={e => e.preventDefault()}
      aria-label={t('object.formLabel')}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
        <Field
          label={t('object.icon')}
          htmlFor={ids.icon}
          hint={t('object.iconHint')}
        >
          <Input id={ids.icon} className="font-mono" {...register('icon')} />
        </Field>
      </div>
      <I18nFields
        control={control}
        name="displayName"
        label={t('fields.displayName')}
        required
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label={t('object.primaryKey')}
          htmlFor={ids.pk}
          required
          error={fieldError(formState.errors, 'primaryKey')}
        >
          <Controller
            control={control}
            name="primaryKey"
            render={({field}) => (
              <NativeSelect
                id={ids.pk}
                options={propOptions}
                placeholder={t('fields.choose')}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Field>
        <Field label={t('object.titleProperty')} htmlFor={ids.title} required>
          <Controller
            control={control}
            name="titleProperty"
            render={({field}) => (
              <NativeSelect
                id={ids.title}
                options={propOptions}
                placeholder={t('fields.choose')}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Field>
      </div>
      <SwitchField
        control={control}
        name="graphProjected"
        label={t('object.graphProjected')}
        hint={t('object.graphProjectedHint')}
      />
      <I18nFields
        control={control}
        name="description"
        label={t('fields.description')}
        multiline
      />

      <section aria-labelledby="props-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id="props-title" className="text-sm font-semibold text-text">
            {t('object.properties')}{' '}
            <span className="num text-dim">{props.fields.length}</span>
          </h3>
          <Button
            size="sm"
            onClick={() =>
              props.append(newProperty(watched.map(p => p.apiName)))
            }
          >
            <Plus aria-hidden />
            {t('object.addProperty')}
          </Button>
        </div>
        {fieldError(formState.errors, 'properties') && (
          <p role="alert" className="text-xs text-crit">
            {t('errors.minOneProperty')}
          </p>
        )}
        <div className="rounded-lg border border-line">
          <Table>
            <THead>
              <tr className="border-b border-line">
                <Th className="w-8 px-1">
                  <span className="sr-only">
                    {t('prop.details', {name: ''})}
                  </span>
                </Th>
                <Th className="px-1.5">{t('fields.apiName')}</Th>
                <Th className="px-1.5">{t('prop.zh')}</Th>
                <Th className="px-1.5">{t('prop.en')}</Th>
                <Th className="px-1.5">{t('prop.dataType')}</Th>
                <Th className="px-1.5 text-center">{t('prop.required')}</Th>
                <Th className="px-1.5 text-center">{t('prop.indexed')}</Th>
                <Th className="px-1.5 text-center">{t('prop.sensitive')}</Th>
                <Th className="px-1.5">
                  <span className="sr-only">{t('fields.actions')}</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {props.fields.map((f, i) => (
                <PropertyRow
                  key={f.id}
                  control={control}
                  index={i}
                  typeNames={typeNames}
                  canRemove={props.fields.length > 1}
                  onRemove={() => props.remove(i)}
                />
              ))}
            </TBody>
          </Table>
        </div>
      </section>
    </form>
  );
}
