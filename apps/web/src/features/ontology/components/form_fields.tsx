/**
 * @fileoverview Small react-hook-form bindings used by the workbench
 * editors: bilingual text fields, JSON(Logic) text areas, checkboxes and
 * switches, plus the form → reducer sync hook.
 */

import {useEffect, useId, useRef, useState} from 'react';
import {
  useController,
  type Control,
  type FieldError,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {Checkbox, Field, Input, Textarea} from '../../../shared/ui/input';
import {Switch} from '../../../shared/ui/switch';

/**
 * Pushes every form change to `onChange` (a structured clone, so reducer
 * state never aliases RHF's internal values).
 */
export function useFormSync<T extends FieldValues>(
  form: UseFormReturn<T>,
  onChange: (value: T) => void,
): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const sub = form.watch((v, info) => {
      // Only user edits and field-array operations carry a field name.
      if (info.name) cb.current(structuredClone(v) as T);
    });
    return () => sub.unsubscribe();
  }, [form]);
}

/** Reads a nested field error by dotted path. */
export function fieldError(errors: unknown, path: string): string | undefined {
  let cur: unknown = errors;
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  const e = cur as FieldError | undefined;
  return typeof e?.message === 'string' ? e.message : undefined;
}

/** zh-CN / en-US text inputs bound to an I18nText map. */
export function I18nFields<T extends FieldValues>({
  control,
  name,
  label,
  required,
  size = 'md',
  multiline,
  className,
}: {
  control: Control<T>;
  name: string;
  label: string;
  required?: boolean;
  size?: 'sm' | 'md';
  multiline?: boolean;
  className?: string;
}) {
  const {t} = useTranslation('ontology');
  const id = useId();
  const zh = useController({control, name: `${name}.zh-CN` as Path<T>});
  const en = useController({control, name: `${name}.en-US` as Path<T>});
  const Comp = multiline ? Textarea : Input;
  const sizeProps = multiline
    ? {rows: 2, className: 'min-h-14'}
    : {inputSize: size};
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', className)}>
      <Field
        label={`${label} · ${t('lang.zh')}`}
        htmlFor={`${id}-zh`}
        required={required}
      >
        <Comp
          id={`${id}-zh`}
          {...sizeProps}
          value={(zh.field.value as string | undefined) ?? ''}
          onChange={e => zh.field.onChange(e.target.value)}
          onBlur={zh.field.onBlur}
        />
      </Field>
      <Field label={`${label} · ${t('lang.en')}`} htmlFor={`${id}-en`}>
        <Comp
          id={`${id}-en`}
          {...sizeProps}
          value={(en.field.value as string | undefined) ?? ''}
          onChange={e => en.field.onChange(e.target.value)}
          onBlur={en.field.onBlur}
        />
      </Field>
    </div>
  );
}

/**
 * JSON text editor bound to an arbitrary JSON value. Invalid JSON is shown
 * inline and not propagated. With `lenient`, non-JSON text is kept as a
 * plain string.
 */
export function JsonField<T extends FieldValues>({
  control,
  name,
  label,
  lenient,
  multiline = true,
  placeholder,
  hideLabel,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  lenient?: boolean;
  multiline?: boolean;
  placeholder?: string;
  hideLabel?: boolean;
}) {
  const {t} = useTranslation('ontology');
  const id = useId();
  const {field} = useController({control, name});
  const toText = (v: unknown) => {
    if (v === undefined || v === '') return '';
    if (lenient && typeof v === 'string') return v;
    return multiline ? JSON.stringify(v, null, 2) : JSON.stringify(v);
  };
  const [text, setText] = useState(() => toText(field.value));
  const [error, setError] = useState<string>();

  const onText = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setError(undefined);
      field.onChange(lenient ? '' : null);
      return;
    }
    try {
      field.onChange(JSON.parse(next));
      setError(undefined);
    } catch {
      if (lenient) {
        field.onChange(next);
        setError(undefined);
      } else {
        setError(t('json.invalid'));
      }
    }
  };

  const control_ = multiline ? (
    <Textarea
      id={id}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={!!error}
      spellCheck={false}
      className="min-h-16 font-mono text-xs"
      value={text}
      placeholder={placeholder}
      onChange={e => onText(e.target.value)}
      onBlur={field.onBlur}
    />
  ) : (
    <Input
      id={id}
      inputSize="sm"
      aria-label={hideLabel ? label : undefined}
      aria-invalid={!!error}
      spellCheck={false}
      className="font-mono"
      value={text}
      placeholder={placeholder}
      onChange={e => onText(e.target.value)}
      onBlur={field.onBlur}
    />
  );
  if (hideLabel) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {control_}
        {error && (
          <p role="alert" className="text-xs text-crit">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <Field label={label} htmlFor={id} error={error}>
      {control_}
    </Field>
  );
}

/** Checkbox bound to a boolean field. */
export function CheckField<T extends FieldValues>({
  control,
  name,
  label,
  showLabel,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  showLabel?: boolean;
}) {
  const id = useId();
  const {field} = useController({control, name});
  return (
    <span className="inline-flex items-center gap-1.5">
      <Checkbox
        id={id}
        aria-label={showLabel ? undefined : label}
        checked={!!field.value}
        onCheckedChange={v => field.onChange(v === true)}
      />
      {showLabel && (
        <label htmlFor={id} className="text-xs whitespace-nowrap text-muted">
          {label}
        </label>
      )}
    </span>
  );
}

/** Switch + label bound to a boolean field. */
export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  hint?: string;
}) {
  const id = useId();
  const {field} = useController({control, name});
  return (
    <div className="flex items-start gap-2.5">
      <Switch
        id={id}
        checked={!!field.value}
        onCheckedChange={v => field.onChange(v)}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-text">
          {label}
        </label>
        {hint && <p className="text-xs text-dim">{hint}</p>}
      </div>
    </div>
  );
}
