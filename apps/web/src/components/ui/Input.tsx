/**
 * Input — single-line text input with left/right adornment slots.
 */
import { forwardRef, InputHTMLAttributes, ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  invalid?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', style, leftIcon, rightIcon, invalid, id, ...rest },
  ref,
) {
  return (
    <div
      className={className}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', borderRadius: 'var(--radius-md)',
        background: '#fff',
        border: `1px solid ${invalid ? 'var(--color-danger)' : 'var(--color-neutral-300)'}`,
        boxShadow: invalid ? '0 0 0 3px rgba(197,34,31,0.10)' : 'none',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        ...style,
      }}
    >
      {leftIcon}
      <input
        ref={ref}
        id={id}
        style={{
          flex: 1, border: 'none', outline: 'none', background: 'transparent',
          fontSize: 14, color: 'var(--color-neutral-900)', minWidth: 0,
          fontFamily: 'inherit',
        }}
        {...rest}
      />
      {rightIcon}
    </div>
  );
});

export default Input;
