/**
 * Switch — animated on/off toggle control.
 */
import { InputHTMLAttributes } from 'react';

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export default function Switch({
  id, className = '', style, label, checked, ...rest
}: SwitchProps) {
  const _id = id ?? rest.name ?? 'sw';
  return (
    <label
      htmlFor={_id}
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        fontSize: 14, color: 'var(--color-neutral-900)', userSelect: 'none',
        ...style,
      }}
    >
      <span
        style={{
          position: 'relative', width: 36, height: 20,
          borderRadius: 999,
          background: checked ? 'var(--color-primary)' : 'var(--color-neutral-300)',
          transition: 'background .15s ease',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2,
            left: checked ? 18 : 2, width: 16, height: 16, borderRadius: '50%',
            background: '#fff', boxShadow: 'var(--shadow-sm)',
            transition: 'left .15s ease',
          }}
        />
      </span>
      <input
        id={_id}
        type="checkbox"
        role="switch"
        aria-checked={!!checked}
        checked={checked}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
        {...rest}
      />
      {label}
    </label>
  );
}
