/**
 * @fileoverview Text inputs, label, checkbox and form field wrapper.
 */

import * as C from '@radix-ui/react-checkbox';
import * as L from '@radix-ui/react-label';
import {Check} from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {cn} from '../lib/cn';

const base =
  'w-full min-w-0 rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-2.5 text-sm text-text placeholder:text-dim outline-none transition-colors hover:border-cyan/40 focus-visible:border-cyan disabled:opacity-50 aria-[invalid=true]:border-crit';

/** Text input. */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {inputSize?: 'sm' | 'md'}
>(({className, inputSize = 'md', ...props}, ref) => (
  <input
    ref={ref}
    className={cn(base, inputSize === 'sm' ? 'h-7 text-xs' : 'h-9', className)}
    {...props}
  />
));
Input.displayName = 'Input';

/** Multi-line input. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({className, ...props}, ref) => (
  <textarea
    ref={ref}
    className={cn(base, 'min-h-20 py-2', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/** Form label. */
export function Label({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof L.Root>) {
  return (
    <L.Root
      className={cn('text-xs font-medium text-muted', className)}
      {...props}
    />
  );
}

/** Checkbox. */
export function Checkbox({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded border border-line-2 bg-panel-2 data-[state=checked]:border-cyan data-[state=checked]:bg-cyan/20 disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <C.Indicator>
        <Check className="size-3 text-cyan" aria-hidden />
      </C.Indicator>
    </C.Root>
  );
}

/** Label + control + hint/error. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  error?: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ml-0.5 text-crit" aria-hidden>
            *
          </span>
        )}
      </Label>
      {children}
      {error ? (
        <p
          role="alert"
          className="text-xs text-crit"
          id={htmlFor ? `${htmlFor}-error` : undefined}
        >
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-dim">{hint}</p>
      ) : null}
    </div>
  );
}
