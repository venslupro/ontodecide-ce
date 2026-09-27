/**
 * @fileoverview Small building blocks of the workbench forms: issue text,
 * bilingual name inputs and data type options.
 */

import {useId} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {Field, Input} from '../../../shared/ui/input';
import {type FieldIssue, type I18nPair, SCALAR_DATA_TYPES} from '../model';

/** Issues keyed by path. */
export type IssueMap = ReadonlyMap<string, FieldIssue>;

/** Localized text of an issue. */
export function useIssueText(): (
  i: FieldIssue | undefined,
) => string | undefined {
  const {t} = useTranslation('ontology');
  return i => {
    if (!i) return undefined;
    if (i.code === 'server' || i.code === 'invalid')
      return i.message || t(`issue.${i.code}`);
    return t(`issue.${i.code}`, i.params ?? {});
  };
}

/** Inline error under a cell. */
export function CellError({issue}: {issue?: FieldIssue}) {
  const text = useIssueText()(issue);
  if (!text) return null;
  return (
    <p role="alert" className="mt-0.5 text-[11px] text-crit">
      {text}
    </p>
  );
}

/** zh-CN / en-US name inputs. */
export function I18nInputs({
  label,
  value,
  onChange,
  issue,
  required,
  size = 'md',
  className,
}: {
  label: string;
  value: I18nPair;
  onChange(next: I18nPair): void;
  issue?: FieldIssue;
  required?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const {t} = useTranslation('ontology');
  const id = useId();
  const err = useIssueText()(issue);
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', className)}>
      <Field
        label={t('field.langZh', {label})}
        htmlFor={`${id}-zh`}
        required={required}
        error={err}
      >
        <Input
          id={`${id}-zh`}
          inputSize={size}
          aria-invalid={!!err}
          value={value.zh}
          onChange={e => onChange({...value, zh: e.target.value})}
        />
      </Field>
      <Field label={t('field.langEn', {label})} htmlFor={`${id}-en`}>
        <Input
          id={`${id}-en`}
          inputSize={size}
          value={value.en}
          onChange={e => onChange({...value, en: e.target.value})}
        />
      </Field>
    </div>
  );
}

/** Data type options: scalars and one `objectRef:<Type>` per object type. */
export function useDataTypeOptions(
  typeNames: readonly string[],
): {value: string; label: string}[] {
  const {t} = useTranslation('ontology');
  return [
    ...SCALAR_DATA_TYPES.map(d => ({value: d, label: t(`dataType.${d}`)})),
    ...typeNames.map(n => ({
      value: `objectRef:${n}`,
      label: t('dataType.objectRef', {type: n}),
    })),
  ];
}
