/**
 * EmptyState — placeholder panel for zero-state views.
 * Defaults to an external Unsplash illustration image.
 */
import { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  image?: string;                 /** Custom illustration URL. */
  alt?: string;                   /** Image alt text. */
  action?: { label: string; onClick?: () => void } &
    Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>;
}

export default function EmptyState({
  title, description,
  image = 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=320&q=80&auto=format&fit=crop',
  alt = 'Empty state illustration', action,
  className = '', style, ...rest
}: EmptyStateProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-6)', borderRadius: 'var(--radius-lg)',
        background: '#fff', border: '1px dashed var(--color-neutral-300)',
        color: 'var(--color-neutral-700)', ...style,
      }}
      {...rest}
    >
      <img
        src={image}
        alt={alt}
        style={{
          width: 128, height: 128, objectFit: 'cover',
          borderRadius: '50%', boxShadow: 'var(--shadow-sm)',
          background: 'var(--color-neutral-100)',
        }}
      />
      <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
        {title}
      </h3>
      {description ? (
        <p style={{ maxWidth: 420, fontSize: 14, color: 'var(--color-neutral-500)' }}>
          {description}
        </p>
      ) : null}
      {action ? (
        <button
          type="button"
          aria-label={action['aria-label']}
          onClick={action.onClick}
          style={{
            marginTop: 'var(--space-1)', padding: '8px 16px',
            background: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
