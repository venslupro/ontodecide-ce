/**
 * Breadcrumbs — headless breadcrumb primitive.
 * Accepts items[] and renders them as a nav list. Overridden by shell's own
 * location-aware breadcrumb component.
 */
import { HTMLAttributes, ReactNode } from 'react';

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  current?: boolean;
}

export interface BreadcrumbsProps extends HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
  separator?: ReactNode;
}

export default function Breadcrumbs({
  items, separator = '›', className = '', style, ...rest
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap',
        fontSize: 13, color: 'var(--color-neutral-500)', ...style,
      }}
      {...rest}
    >
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap' }}>
        {items.map((it, idx) => (
          <li
            key={idx}
            style={{ display: 'inline-flex', alignItems: 'center' }}
            aria-current={it.current ? 'page' : undefined}
          >
            {it.href || it.onClick ? (
              <a
                href={it.href ?? '#'}
                onClick={(e) => {
                  if (it.onClick) { e.preventDefault(); it.onClick(); }
                }}
                style={{
                  color: 'var(--color-neutral-700)', fontWeight: it.current ? 600 : 400,
                  textDecoration: 'none',
                }}
              >
                {it.label}
              </a>
            ) : (
              <span style={{ fontWeight: it.current ? 600 : 400, color: it.current ? 'var(--color-neutral-900)' : 'inherit' }}>
                {it.label}
              </span>
            )}
            {idx < items.length - 1 ? (
              <span aria-hidden="true" style={{ margin: '0 8px', color: 'var(--color-neutral-300)' }}>
                {separator}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
