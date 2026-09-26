/**
 * @fileoverview Button with a single primary style (cyan → blue gradient +
 * soft glow); one primary action per page.
 */

import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import {Loader2} from 'lucide-react';
import {forwardRef, type ButtonHTMLAttributes} from 'react';
import {cn} from '../lib/cn';

/** Button variants. */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-btn)] font-medium transition-[background,box-shadow,color,opacity] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[linear-gradient(90deg,var(--cyan),var(--blue))] text-on-accent shadow-[0_0_18px_color-mix(in_srgb,var(--cyan)_35%,transparent)] hover:shadow-[0_0_24px_color-mix(in_srgb,var(--cyan)_55%,transparent)]',
        secondary:
          'border border-line-2 bg-panel-2 text-text hover:border-cyan/60 hover:text-cyan',
        ghost: 'text-muted hover:bg-panel-2 hover:text-text',
        outline: 'border border-line-2 text-text hover:bg-panel-2',
        danger: 'border border-crit/50 bg-crit/10 text-crit hover:bg-crit/20',
        link: 'h-auto px-0 text-cyan underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-11 px-5 text-base',
        icon: 'size-9',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: {variant: 'secondary', size: 'md'},
  },
);

/** Button props. */
export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

/** A button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild,
      loading,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(
          buttonVariants({variant, size}),
          variant === 'link' && 'h-auto',
          className,
        )}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
