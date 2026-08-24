/**
 * Textarea — multi-line text input primitive.
 */
import { forwardRef, TextareaHTMLAttributes } from 'react';

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className = '', style, invalid, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={className}
      style={{
        width: '100%', padding: '10px 12px', fontSize: 14,
        borderRadius: 'var(--radius-md)', background: '#fff',
        border: `1px solid ${invalid ? 'var(--color-danger)' : 'var(--color-neutral-300)'}`,
        color: 'var(--color-neutral-900)', fontFamily: 'inherit',
        lineHeight: 1.5, resize: 'vertical', outline: 'none',
        boxShadow: invalid ? '0 0 0 3px rgba(197,34,31,0.10)' : 'none',
        ...style,
      }}
      {...rest}
    />
  );
});

export default Textarea;
