/**
 * @fileoverview Action type editor: target type, parameters, JSONLogic
 * preconditions with bilingual messages, effects (set / increment / relink /
 * unlink), approval, writeback and simulation impact hints.
 */

import {zodResolver} from '@hookform/resolvers/zod';
import {
  actionTypeDefSchema,
  type ActionTypeDef,
  type EffectDef,
  type ObjectTypeDef,
  type ParamDef,
} from '@ontodecide/ontology/contract';
import type {I18nText} from '@ontodecide/shared-kernel';
import {Plus, Trash2} from 'lucide-react';
import {useId, type ReactNode} from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type Resolver,
} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {Button} from '../../../shared/ui/button';
import {Field, Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {
  CheckField,
  fieldError,
  I18nFields,
  JsonField,
  SwitchField,
  useFormSync,
} from './form_fields';
import {dataTypeOptions} from './object_type_editor';

/** Action type editor props. */
export interface ActionTypeEditorProps {
  value: ActionTypeDef;
  objectTypes: readonly ObjectTypeDef[];
  linkNames: readonly string[];
  onChange(value: ActionTypeDef): void;
}

/** Loose effect shape used by the form (union members flattened). */
interface EffectForm {
  kind: EffectDef['kind'];
  prop?: string;
  value?: unknown;
  by?: unknown;
  link?: string;
  direction?: 'in' | 'out';
  toParam?: string;
}

/**
 * Form shape: recursive JSONLogic / filter values are opaque (`unknown`) so
 * react-hook-form's path types stay shallow.
 */
type ActionForm = Omit<
  ActionTypeDef,
  'parameters' | 'preconditions' | 'effects'
> & {
  parameters: (Omit<ParamDef, 'suggest' | 'defaultValue'> & {
    suggest?: unknown;
    defaultValue?: unknown;
  })[];
  preconditions: {expr: unknown; message: I18nText}[];
  effects: EffectForm[];
};

type Ctl = Control<ActionForm>;

const EFFECT_KINDS = ['set', 'increment', 'relink', 'unlink'] as const;

function effectDefaults(
  kind: EffectDef['kind'],
  prop: string,
  link: string,
): EffectForm {
  switch (kind) {
    case 'set':
      return {kind, prop, value: null};
    case 'increment':
      return {kind, prop, by: 1};
    case 'relink':
      return {kind, link, direction: 'in', toParam: ''};
    case 'unlink':
      return {kind, link, direction: 'in'};
  }
}

function SubSection({
  title,
  count,
  onAdd,
  addLabel,
  children,
  hint,
}: {
  title: string;
  count: number;
  onAdd(): void;
  addLabel: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 id={id} className="text-sm font-semibold text-text">
            {title} <span className="num text-dim">{count}</span>
          </h3>
          {hint && <p className="text-xs text-dim">{hint}</p>}
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}

function EffectRow({
  control,
  index,
  propOptions,
  linkOptions,
  paramOptions,
  onKind,
  onRemove,
}: {
  control: Ctl;
  index: number;
  propOptions: {value: string; label: string}[];
  linkOptions: {value: string; label: string}[];
  paramOptions: {value: string; label: string}[];
  onKind(kind: EffectDef['kind']): void;
  onRemove(): void;
}) {
  const {t} = useTranslation('ontology');
  const eff = useWatch({control, name: `effects.${index}`});
  const kind = eff?.kind ?? 'set';
  const n = index + 1;
  const dirOptions = [
    {value: 'in', label: t('action.dirIn')},
    {value: 'out', label: t('action.dirOut')},
  ];
  const sel = (
    name: string,
    label: string,
    options: {value: string; label: string}[],
    placeholder?: string,
  ) => (
    <Controller
      control={control}
      name={`effects.${index}.${name}` as `effects.${number}.link`}
      render={({field}) => (
        <NativeSelect
          size="sm"
          aria-label={label}
          options={options}
          placeholder={placeholder}
          value={(field.value as string | undefined) ?? ''}
          onChange={e =>
            field.onChange(
              e.target.value === '' && placeholder !== undefined
                ? undefined
                : e.target.value,
            )
          }
        />
      )}
    />
  );
  return (
    <li className="grid grid-cols-1 items-start gap-2 rounded-lg border border-line bg-panel-2/40 p-2.5 md:grid-cols-[8rem_1fr_auto]">
      <NativeSelect
        size="sm"
        aria-label={t('action.effectKindAria', {n})}
        options={EFFECT_KINDS.map(k => ({
          value: k,
          label: t(`action.effectKind.${k}`),
        }))}
        value={kind}
        onChange={e => onKind(e.target.value as EffectDef['kind'])}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(kind === 'set' || kind === 'increment') && (
          <>
            {sel(
              'prop',
              t('action.effectPropAria', {n}),
              propOptions,
              t('fields.choose'),
            )}
            <div className="sm:col-span-2">
              <JsonField
                key={kind}
                control={control}
                name={`effects.${index}.${kind === 'set' ? 'value' : 'by'}`}
                label={
                  kind === 'set'
                    ? t('action.effectValueAria', {n})
                    : t('action.effectByAria', {n})
                }
                multiline={false}
                hideLabel
                placeholder={
                  kind === 'set' ? '"watch"' : '{"var":"params.days"}'
                }
              />
            </div>
          </>
        )}
        {(kind === 'relink' || kind === 'unlink') && (
          <>
            {sel(
              'link',
              t('action.effectLinkAria', {n}),
              linkOptions,
              t('fields.choose'),
            )}
            {sel('direction', t('action.effectDirAria', {n}), dirOptions)}
            {sel(
              'toParam',
              t('action.effectParamAria', {n}),
              paramOptions,
              kind === 'unlink' ? t('action.noParam') : t('fields.choose'),
            )}
          </>
        )}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t('action.removeEffect', {n})}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

/** Action type form. */
export function ActionTypeEditor({
  value,
  objectTypes,
  linkNames,
  onChange,
}: ActionTypeEditorProps) {
  const {t} = useTranslation('ontology');
  const form = useForm<ActionForm>({
    defaultValues: value as ActionForm,
    resolver: zodResolver(
      actionTypeDefSchema,
    ) as unknown as Resolver<ActionForm>,
    mode: 'onChange',
  });
  useFormSync(form, v => onChange(v as ActionTypeDef));
  const {control, register, formState} = form;
  const params = useFieldArray({control, name: 'parameters'});
  const pre = useFieldArray({control, name: 'preconditions'});
  const effects = useFieldArray({control, name: 'effects'});
  const impact = useFieldArray({control, name: 'impact'});
  const targetType = useWatch({control, name: 'targetType'});
  const paramValues = useWatch({control, name: 'parameters'}) ?? [];
  const writeback = useWatch({control, name: 'writeback'});
  const ids = {api: useId(), target: useId(), wb: useId(), url: useId()};

  const typeNames = objectTypes.map(o => o.apiName);
  const typeOptions = typeNames.map(n => ({value: n, label: n}));
  const target = objectTypes.find(o => o.apiName === targetType);
  const propOptions = (target?.properties ?? []).map(p => ({
    value: p.apiName,
    label: p.apiName,
  }));
  const linkOptions = linkNames.map(n => ({value: n, label: n}));
  const paramOptions = paramValues.map(p => ({
    value: p.apiName,
    label: p.apiName,
  }));
  const apiErr = fieldError(formState.errors, 'apiName');
  const urlErr = fieldError(formState.errors, 'writeback.url');

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={e => e.preventDefault()}
      aria-label={t('action.formLabel')}
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
        <Field label={t('action.targetType')} htmlFor={ids.target} required>
          <Controller
            control={control}
            name="targetType"
            render={({field}) => (
              <NativeSelect
                id={ids.target}
                options={typeOptions}
                placeholder={t('fields.choose')}
                value={field.value}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          />
        </Field>
      </div>
      <I18nFields
        control={control}
        name="displayName"
        label={t('fields.displayName')}
        required
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SwitchField
          control={control}
          name="requiresApproval"
          label={t('action.requiresApproval')}
          hint={t('action.requiresApprovalHint')}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
          <Field label={t('action.writeback')} htmlFor={ids.wb}>
            <Controller
              control={control}
              name="writeback"
              render={({field}) => (
                <NativeSelect
                  id={ids.wb}
                  options={[
                    {value: 'none', label: t('action.writebackNone')},
                    {value: 'webhook', label: t('action.writebackWebhook')},
                  ]}
                  value={field.value?.kind ?? 'none'}
                  onChange={e =>
                    field.onChange(
                      e.target.value === 'webhook'
                        ? {kind: 'webhook', url: ''}
                        : {kind: 'none'},
                    )
                  }
                />
              )}
            />
          </Field>
          {writeback?.kind === 'webhook' && (
            <Field
              label={t('action.webhookUrl')}
              htmlFor={ids.url}
              required
              error={urlErr && t('errors.url')}
            >
              <Input
                id={ids.url}
                type="url"
                placeholder="https://"
                aria-invalid={!!urlErr}
                {...register('writeback.url' as 'apiName')}
              />
            </Field>
          )}
        </div>
      </div>

      <SubSection
        title={t('action.parameters')}
        count={params.fields.length}
        addLabel={t('action.addParameter')}
        onAdd={() =>
          params.append({
            apiName: `param${params.fields.length + 1}`,
            displayName: {'zh-CN': '', 'en-US': ''},
            dataType: 'string',
          })
        }
      >
        {params.fields.length === 0 ? (
          <p className="text-xs text-dim">{t('action.noParameters')}</p>
        ) : (
          <div className="rounded-lg border border-line">
            <Table>
              <THead>
                <tr className="border-b border-line">
                  <Th className="px-1.5">{t('fields.apiName')}</Th>
                  <Th className="px-1.5">{t('prop.zh')}</Th>
                  <Th className="px-1.5">{t('prop.en')}</Th>
                  <Th className="px-1.5">{t('prop.dataType')}</Th>
                  <Th className="px-1.5 text-center">{t('prop.required')}</Th>
                  <Th className="px-1.5">{t('action.defaultValue')}</Th>
                  <Th className="px-1.5">
                    <span className="sr-only">{t('fields.actions')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {params.fields.map((f, i) => {
                  const name = paramValues[i]?.apiName || `#${i + 1}`;
                  return (
                    <Tr key={f.id} className="align-top">
                      <Td className="min-w-28 px-1.5">
                        <Input
                          inputSize="sm"
                          className="font-mono"
                          aria-label={t('action.paramApiAria', {n: i + 1})}
                          {...register(`parameters.${i}.apiName`)}
                        />
                      </Td>
                      <Td className="min-w-24 px-1.5">
                        <Input
                          inputSize="sm"
                          aria-label={t('prop.zhAria', {name})}
                          {...register(
                            `parameters.${i}.displayName.zh-CN` as `parameters.${number}.apiName`,
                          )}
                        />
                      </Td>
                      <Td className="min-w-24 px-1.5">
                        <Input
                          inputSize="sm"
                          aria-label={t('prop.enAria', {name})}
                          {...register(
                            `parameters.${i}.displayName.en-US` as `parameters.${number}.apiName`,
                          )}
                        />
                      </Td>
                      <Td className="min-w-32 px-1.5">
                        <Controller
                          control={control}
                          name={`parameters.${i}.dataType`}
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
                          name={`parameters.${i}.required`}
                          label={t('prop.requiredAria', {name})}
                        />
                      </Td>
                      <Td className="min-w-28 px-1.5">
                        <JsonField
                          control={control}
                          name={`parameters.${i}.defaultValue`}
                          label={t('action.defaultValueAria', {name})}
                          lenient
                          multiline={false}
                          hideLabel
                        />
                      </Td>
                      <Td className="px-1.5">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('action.removeParameter', {name})}
                          onClick={() => params.remove(i)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </SubSection>

      <SubSection
        title={t('action.preconditions')}
        count={pre.fields.length}
        addLabel={t('action.addPrecondition')}
        hint={t('action.preconditionsHint')}
        onAdd={() =>
          pre.append({
            expr: {'!==': [{var: 'target.status'}, 'suspended']},
            message: {'zh-CN': '', 'en-US': ''},
          })
        }
      >
        {pre.fields.length === 0 ? (
          <p className="text-xs text-dim">{t('action.noPreconditions')}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {pre.fields.map((f, i) => (
              <li
                key={f.id}
                className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2/40 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted">
                    {t('action.preconditionN', {n: i + 1})}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('action.removePrecondition', {n: i + 1})}
                    onClick={() => pre.remove(i)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <JsonField
                  control={control}
                  name={`preconditions.${i}.expr`}
                  label={t('action.expr')}
                />
                <I18nFields
                  control={control}
                  name={`preconditions.${i}.message`}
                  label={t('action.message')}
                  size="sm"
                />
              </li>
            ))}
          </ol>
        )}
      </SubSection>

      <SubSection
        title={t('action.effects')}
        count={effects.fields.length}
        addLabel={t('action.addEffect')}
        hint={t('action.effectsHint')}
        onAdd={() =>
          effects.append(
            effectDefaults(
              'set',
              propOptions[0]?.value ?? '',
              linkOptions[0]?.value ?? '',
            ),
          )
        }
      >
        {effects.fields.length === 0 ? (
          <p className="text-xs text-dim">{t('action.noEffects')}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {effects.fields.map((f, i) => (
              <EffectRow
                key={f.id}
                control={control}
                index={i}
                propOptions={propOptions}
                linkOptions={linkOptions}
                paramOptions={paramOptions}
                onKind={k =>
                  effects.update(
                    i,
                    effectDefaults(
                      k,
                      propOptions[0]?.value ?? '',
                      linkOptions[0]?.value ?? '',
                    ),
                  )
                }
                onRemove={() => effects.remove(i)}
              />
            ))}
          </ol>
        )}
      </SubSection>

      <SubSection
        title={t('action.impact')}
        count={impact.fields.length}
        addLabel={t('action.addImpact')}
        hint={t('action.impactHint')}
        onAdd={() =>
          impact.append({property: propOptions[0]?.value ?? '', change: 0.1})
        }
      >
        {impact.fields.length > 0 && (
          <ul className="flex flex-col gap-2">
            {impact.fields.map((f, i) => (
              <li
                key={f.id}
                className="grid grid-cols-[1fr_7rem_auto] items-center gap-2"
              >
                <Controller
                  control={control}
                  name={`impact.${i}.property`}
                  render={({field}) => (
                    <NativeSelect
                      size="sm"
                      aria-label={t('action.impactPropAria', {n: i + 1})}
                      options={propOptions}
                      placeholder={t('fields.choose')}
                      value={field.value}
                      onChange={e => field.onChange(e.target.value)}
                    />
                  )}
                />
                <Input
                  type="number"
                  inputSize="sm"
                  min={-1}
                  max={1}
                  step={0.05}
                  className="num"
                  aria-label={t('action.impactChangeAria', {n: i + 1})}
                  aria-invalid={
                    !!fieldError(formState.errors, `impact.${i}.change`)
                  }
                  {...register(`impact.${i}.change`, {valueAsNumber: true})}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('action.removeImpact', {n: i + 1})}
                  onClick={() => impact.remove(i)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SubSection>
    </form>
  );
}
