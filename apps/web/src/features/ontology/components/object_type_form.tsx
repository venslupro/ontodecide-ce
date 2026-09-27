/**
 * @fileoverview Object type form: api name, bilingual names, icon, primary
 * key and title property, and the properties table (data type incl.
 * `objectRef:<Type>` and enum values, unit, required, indexed — at most
 * MAX_INDEXED_PROPS per type —, sensitive, semantic tags).
 */

import {Plus, Trash2} from 'lucide-react';
import {Fragment, useId} from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Checkbox, Field, Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {
  MAX_INDEXED_PROPS,
  newPropertyForm,
  type ObjectTypeForm,
  type PropertyForm,
} from '../model';
import {ChipsInput} from './chips_input';
import {
  CellError,
  I18nInputs,
  type IssueMap,
  useDataTypeOptions,
  useIssueText,
} from './form_bits';

/** Object type form props. */
export interface ObjectTypeFormProps {
  form: ObjectTypeForm;
  onChange(next: ObjectTypeForm): void;
  issues: IssueMap;
  /** Existing definitions keep their api name (it is the REST id). */
  isNew: boolean;
  /** All object type api names (for `objectRef:*`). */
  typeNames: readonly string[];
}

/** The form. */
export function ObjectTypeFormView({
  form,
  onChange,
  issues,
  isNew,
  typeNames,
}: ObjectTypeFormProps) {
  const {t} = useTranslation('ontology');
  const id = useId();
  const issueText = useIssueText();
  const dataTypes = useDataTypeOptions([
    ...new Set([...typeNames, ...(form.apiName ? [form.apiName] : [])]),
  ]);
  const indexed = form.properties.filter(p => p.indexed).length;
  const propNames = form.properties
    .map(p => p.apiName)
    .filter(Boolean)
    .map(n => ({value: n, label: n}));
  const setProp = (i: number, patch: Partial<PropertyForm>) =>
    onChange({
      ...form,
      properties: form.properties.map((p, j) =>
        j === i ? {...p, ...patch} : p,
      ),
    });
  const removeProp = (i: number) =>
    onChange({...form, properties: form.properties.filter((_, j) => j !== i)});
  const apiErr = issueText(issues.get('apiName'));
  const pkErr = issueText(issues.get('primaryKey'));
  const titleErr = issueText(issues.get('titleProperty'));
  const propsErr = issueText(issues.get('properties'));

  return (
    <div className="flex flex-col gap-4">
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
        <Field label={t('field.icon')} htmlFor={`${id}-icon`}>
          <Input
            id={`${id}-icon`}
            value={form.icon}
            placeholder={t('field.iconHint')}
            onChange={e => onChange({...form, icon: e.target.value})}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={t('field.primaryKey')}
          htmlFor={`${id}-pk`}
          required
          error={pkErr}
        >
          <NativeSelect
            id={`${id}-pk`}
            className="font-mono"
            value={form.primaryKey}
            placeholder={t('field.chooseProperty')}
            aria-invalid={!!pkErr}
            options={propNames}
            onChange={e => onChange({...form, primaryKey: e.target.value})}
          />
        </Field>
        <Field
          label={t('field.titleProperty')}
          htmlFor={`${id}-title`}
          required
          error={titleErr}
        >
          <NativeSelect
            id={`${id}-title`}
            className="font-mono"
            value={form.titleProperty}
            placeholder={t('field.chooseProperty')}
            aria-invalid={!!titleErr}
            options={propNames}
            onChange={e => onChange({...form, titleProperty: e.target.value})}
          />
        </Field>
      </div>

      <section aria-labelledby={`${id}-props`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${id}-props`} className="text-sm font-semibold text-text">
            {t('prop.title')}
          </h3>
          <Badge
            tone={indexed > MAX_INDEXED_PROPS ? 'crit' : 'neutral'}
            className="num"
          >
            {t('prop.indexedCount', {count: indexed, max: MAX_INDEXED_PROPS})}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() =>
              onChange({
                ...form,
                properties: [...form.properties, newPropertyForm()],
              })
            }
          >
            <Plus aria-hidden />
            {t('prop.add')}
          </Button>
        </div>
        {propsErr && (
          <p role="alert" className="text-xs text-crit">
            {propsErr}
          </p>
        )}
        <div className="overflow-x-auto">
          <Table aria-label={t('prop.title')}>
            <THead>
              <Tr>
                <Th>{t('prop.apiName')}</Th>
                <Th>{t('prop.nameZh')}</Th>
                <Th>{t('prop.nameEn')}</Th>
                <Th>{t('prop.dataType')}</Th>
                <Th>{t('prop.unit')}</Th>
                <Th className="text-center">{t('prop.required')}</Th>
                <Th className="text-center">{t('prop.indexed')}</Th>
                <Th className="text-center">{t('prop.sensitive')}</Th>
                <Th>{t('prop.tags')}</Th>
                <Th>
                  <span className="sr-only">{t('prop.actions')}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {form.properties.map((p, i) => {
                const name = p.apiName || `#${i + 1}`;
                const path = `properties.${i}`;
                return (
                  <Fragment key={p.key}>
                    <Tr className="align-top" data-testid="property-row">
                      <Td className="min-w-32 px-1.5">
                        <Input
                          inputSize="sm"
                          className="font-mono"
                          aria-label={t('prop.apiNameAria', {n: i + 1})}
                          aria-invalid={issues.has(`${path}.apiName`)}
                          value={p.apiName}
                          onChange={e => setProp(i, {apiName: e.target.value})}
                        />
                        <CellError issue={issues.get(`${path}.apiName`)} />
                      </Td>
                      <Td className="min-w-28 px-1.5">
                        <Input
                          inputSize="sm"
                          aria-label={t('prop.nameZhAria', {name})}
                          aria-invalid={issues.has(`${path}.displayName`)}
                          value={p.displayName.zh}
                          onChange={e =>
                            setProp(i, {
                              displayName: {
                                ...p.displayName,
                                zh: e.target.value,
                              },
                            })
                          }
                        />
                        <CellError issue={issues.get(`${path}.displayName`)} />
                      </Td>
                      <Td className="min-w-28 px-1.5">
                        <Input
                          inputSize="sm"
                          aria-label={t('prop.nameEnAria', {name})}
                          value={p.displayName.en}
                          onChange={e =>
                            setProp(i, {
                              displayName: {
                                ...p.displayName,
                                en: e.target.value,
                              },
                            })
                          }
                        />
                      </Td>
                      <Td className="min-w-36 px-1.5">
                        <NativeSelect
                          size="sm"
                          aria-label={t('prop.dataTypeAria', {name})}
                          aria-invalid={issues.has(`${path}.dataType`)}
                          value={p.dataType}
                          options={dataTypes}
                          onChange={e => setProp(i, {dataType: e.target.value})}
                        />
                        <CellError issue={issues.get(`${path}.dataType`)} />
                      </Td>
                      <Td className="w-20 px-1.5">
                        <Input
                          inputSize="sm"
                          aria-label={t('prop.unitAria', {name})}
                          value={p.unit}
                          onChange={e => setProp(i, {unit: e.target.value})}
                        />
                      </Td>
                      <Td className="px-1.5 text-center">
                        <Checkbox
                          aria-label={t('prop.requiredAria', {name})}
                          checked={p.required}
                          onCheckedChange={v =>
                            setProp(i, {required: v === true})
                          }
                        />
                      </Td>
                      <Td className="px-1.5 text-center">
                        <Checkbox
                          aria-label={t('prop.indexedAria', {name})}
                          checked={p.indexed}
                          disabled={!p.indexed && indexed >= MAX_INDEXED_PROPS}
                          title={
                            !p.indexed && indexed >= MAX_INDEXED_PROPS
                              ? t('prop.indexedFull', {max: MAX_INDEXED_PROPS})
                              : undefined
                          }
                          onCheckedChange={v =>
                            setProp(i, {indexed: v === true})
                          }
                        />
                      </Td>
                      <Td className="px-1.5 text-center">
                        <Checkbox
                          aria-label={t('prop.sensitiveAria', {name})}
                          checked={p.sensitive}
                          onCheckedChange={v =>
                            setProp(i, {sensitive: v === true})
                          }
                        />
                      </Td>
                      <Td className="min-w-40 px-1.5">
                        <ChipsInput
                          size="sm"
                          tone="violet"
                          value={p.semanticTags}
                          label={t('prop.tagsAria', {name})}
                          removeLabel={v => t('prop.removeTag', {tag: v})}
                          suggestions={['risk', 'money', 'time', 'geo']}
                          onChange={v => setProp(i, {semanticTags: v})}
                        />
                      </Td>
                      <Td className="px-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('prop.remove', {name})}
                          disabled={form.properties.length <= 1}
                          onClick={() => removeProp(i)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </Td>
                    </Tr>
                    {p.dataType === 'enum' && (
                      <Tr>
                        <Td colSpan={10} className="px-1.5 pt-0">
                          <div className="flex items-center gap-2 pl-2">
                            <span className="shrink-0 text-xs text-muted">
                              {t('prop.enumValues')}
                            </span>
                            <ChipsInput
                              size="sm"
                              tone="cyan"
                              className="flex-1"
                              value={p.enumValues}
                              label={t('prop.enumAria', {name})}
                              removeLabel={v =>
                                t('prop.removeEnum', {value: v})
                              }
                              placeholder={t('prop.enumHint')}
                              onChange={v => setProp(i, {enumValues: v})}
                            />
                          </div>
                          <CellError issue={issues.get(`${path}.enumValues`)} />
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
