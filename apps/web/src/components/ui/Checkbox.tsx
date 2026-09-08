/**
 * Checkbox — labelled form checkbox.
 */
import { InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  /** Tri-state indeterminate flag; set imperatively on the DOM node. */
  indeterminate?: boolean;
}

export default function Checkbox({
  id, className = '', style, label, indeterminate, ...rest
}: CheckboxProps) {
  const inputId = id ?? rest.name ?? 'cb';
  return (
    <label
      htmlFor={inputId}
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        fontSize: 14, color: 'var(--color-neutral-900)', userSelect: 'none',
        ...style,
      }}
    >
      <input
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        id={inputId}
        type="checkbox"
        style={{ width: 16, height: 16, accentColor: 'var(--color-primary)' }}
        {...rest}
      />
      {label}
    </label>
  );
}
