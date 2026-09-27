/**
 * @fileoverview Wizard step 1 (选择来源): file import is the only source in
 * CE — pick the file format (CSV / XLSX / JSON) and the target object type.
 */

import {Braces, FileSpreadsheet, FileText} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import type {UiObjectType} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {Field} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {FILE_FORMATS, type FileFormat} from '../../../workers/parse_core';

const ICONS: Record<FileFormat, ReactNode> = {
  csv: <FileText aria-hidden />,
  xlsx: <FileSpreadsheet aria-hidden />,
  json: <Braces aria-hidden />,
};

/** Step 1: source format and target type. */
export function SourceStep({
  format,
  onFormat,
  targetType,
  onTargetType,
  types,
}: {
  format: FileFormat;
  onFormat: (f: FileFormat) => void;
  targetType: string;
  onTargetType: (t: string) => void;
  types: readonly UiObjectType[];
}) {
  const {t} = useTranslation('imports');
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{t('source.onlyFile')}</p>
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">
          {t('source.formatLabel')}
        </legend>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup">
          {FILE_FORMATS.map(f => {
            const active = f === format;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onFormat(f)}
                className={cn(
                  'glass flex flex-col items-start gap-1.5 p-4 text-left transition-colors',
                  active
                    ? 'border-cyan text-cyan'
                    : 'text-text hover:border-cyan/50',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4">
                  {ICONS[f]}
                  {t(`source.formats.${f}.title`)}
                </span>
                <span className="text-xs text-muted">
                  {t(`source.formats.${f}.desc`)}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field
        label={t('source.target')}
        htmlFor="import-target-type"
        hint={t('source.targetHint')}
        required
        className="max-w-sm"
      >
        <NativeSelect
          id="import-target-type"
          value={targetType}
          onChange={e => onTargetType(e.target.value)}
          placeholder={t('source.targetPlaceholder')}
          options={types.map(ty => ({
            value: ty.apiName,
            label: `${ty.displayName} (${ty.apiName})`,
          }))}
        />
      </Field>
    </div>
  );
}
