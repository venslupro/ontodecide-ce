/**
 * IconButton — clickable square button for icons/emoji/SVG.
 * Supports size, variant, aria-label (required when no children text).
 */
import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'solid' | 'outline' | 'ghost';

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
}

const sizes: Record<IconButtonSize, React.CSSProperties> = {
  sm: { width: 28, height: 28, fontSize: 14 },
  md: { width: 36, height: 36, fontSize: 16 },
  lg: { width: 44, height: 44, fontSize: 20 },
};
const variants: Record<IconButtonVariant, React.CSSProperties> = {
  solid: {
    background: 'var(--color-primary)', color: '#fff',
    border: '1px solid var(--color-primary)', boxShadow: 'var(--shadow-sm)',
  },
  outline: {
    background: '#fff', color: 'var(--color-neutral-700)',
    border: '1px solid var(--color-neutral-200)',
  },
  ghost: {
    background: 'transparent', color: 'var(--color-neutral-700)',
    border: '1px solid transparent',
  },
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', className = '', style, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)', cursor: 'pointer',
        padding: 0,
        transition: 'all .15s ease',
        ...sizes[size], ...variants[variant], ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
