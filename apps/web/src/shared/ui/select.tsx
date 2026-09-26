/**
 * @fileoverview Select built on Radix Select with a simple options API.
 */

import * as S from '@radix-ui/react-select';
import {Check, ChevronDown} from 'lucide-react';
import {forwardRef, type ReactNode} from 'react';
import {cn} from '../lib/cn';

/** One option. */
export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** Radix select only allows non-empty values; this sentinel stands for "". */
const EMPTY = '__od_empty__';

/** Single-value select. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  id,
  size = 'md',
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
}: {
  value: string | undefined;
  onValueChange(v: string): void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <S.Root
      value={value === '' ? EMPTY : value}
      onValueChange={v => onValueChange(v === EMPTY ? '' : v)}
      disabled={disabled}
    >
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        className={cn(
          'inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-2.5 text-left text-text outline-none hover:border-cyan/50 focus-visible:border-cyan disabled:opacity-50 aria-[invalid=true]:border-crit data-[placeholder]:text-dim',
          size === 'sm' ? 'h-7 text-xs' : 'h-9 text-sm',
          className,
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown className="size-4 text-dim" aria-hidden />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] border border-line-2 bg-panel-solid shadow-[var(--shadow)]"
        >
          <S.Viewport className="p-1">
            {options.map(o => (
              <S.Item
                key={o.value || EMPTY}
                value={o.value === '' ? EMPTY : o.value}
                disabled={o.disabled}
                className="relative flex cursor-pointer items-center rounded-md py-1.5 pr-2 pl-7 text-sm text-text outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-panel-2 data-[highlighted]:text-cyan"
              >
                <S.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-3.5 text-cyan" aria-hidden />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/**
 * Native select styled like {@link Select}. Preferred inside dense forms and
 * tables (fully keyboard accessible, testable with `selectOptions`).
 */
/** Native select props. */
export type NativeSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'size'
> & {
  options: {value: string; label: string; disabled?: boolean}[];
  placeholder?: string;
  size?: 'sm' | 'md';
};

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({className, options, placeholder, size = 'md', ...props}, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'w-full min-w-0 rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-2 text-text outline-none hover:border-cyan/50 focus-visible:border-cyan disabled:opacity-50 aria-[invalid=true]:border-crit',
          size === 'sm' ? 'h-7 text-xs' : 'h-9 text-sm',
          className,
        )}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => (
          <option
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className="bg-panel-solid"
          >
            {o.label}
          </option>
        ))}
      </select>
    );
  },
);
