/**
 * Checkbox — labelled form checkbox.
 */
import { InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

export default function Checkbox({
  id, className = '', style, label, ...rest
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
        id={inputId}
        type="checkbox"
        style={{ width: 16, height: 16, accentColor: 'var(--color-primary)' }}
        {...rest}
      />
      {label}
    </label>
  );
}
