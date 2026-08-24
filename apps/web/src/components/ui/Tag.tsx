/**
 * Tag — chip-style component for key factors / labels. Dismissible via onClose.
 */
import { HTMLAttributes, ReactNode } from 'react';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode;
  onClose?: () => void;
  tone?: 'primary' | 'neutral';
}

export default function Tag({
  tone = 'neutral', className = '', style, children, onClose, ...rest
}: TagProps) {
  const primary = tone === 'primary';
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999, fontSize: 12,
        fontWeight: 500, lineHeight: 1.4,
        background: primary ? 'var(--color-primary-50)' : 'var(--color-neutral-100)',
        color: primary ? 'var(--color-primary)' : 'var(--color-neutral-700)',
        border: `1px solid ${primary ? '#D4C7FC' : 'var(--color-neutral-200)'}`,
        ...style,
      }}
      {...rest}
    >
      {children}
      {onClose ? (
        <button
          type="button"
          aria-label="Remove tag"
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0,
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
