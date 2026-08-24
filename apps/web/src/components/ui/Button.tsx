/**
 * Button — primary action UI primitive.
 * Props: variant (primary/secondary/outline/ghost/danger), size (sm/md/lg),
 * className override, aria-label supported through rest props.
 */
import { ButtonHTMLAttributes, forwardRef } from 'react';

export type ButtonVariant =
  | 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: 6, cursor: 'pointer', fontWeight: 600,
  border: '1px solid transparent', fontFamily: 'inherit',
  transition: 'all 0.15s ease', userSelect: 'none',
};
const variants: Record<ButtonVariant, React.CSSProperties> = {
  primary:   { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)', boxShadow: 'var(--shadow-sm)' },
  secondary: { background: 'var(--color-neutral-100)', color: 'var(--color-neutral-900)', borderColor: 'var(--color-neutral-200)' },
  outline:   { background: '#fff', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' },
  ghost:     { background: 'transparent', color: 'var(--color-neutral-700)' },
  danger:    { background: 'var(--color-danger)', color: '#fff', borderColor: 'var(--color-danger)', boxShadow: 'var(--shadow-sm)' },
};
const sizes: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '6px 12px', fontSize: 13, borderRadius: 'var(--radius-sm)' },
  md: { padding: '10px 16px', fontSize: 14, borderRadius: 'var(--radius-md)' },
  lg: { padding: '14px 20px', fontSize: 15, borderRadius: 'var(--radius-lg)' },
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', style, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={className}
      style={{ ...base, ...variants[variant], ...sizes[size], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Button;
