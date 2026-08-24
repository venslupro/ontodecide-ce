/**
 * Pagination — page + size controls. Calls onChange({ page, size }).
 */
import { HTMLAttributes } from 'react';

export interface PaginationProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  page: number;            /** 1-based page. */
  size: number;            /** Rows per page. */
  total: number;           /** Total rows. */
  sizes?: number[];
  onChange: (p: { page: number; size: number }) => void;
}

export default function Pagination({
  page, size, total, sizes = [10, 20, 50, 100], onChange,
  className = '', style, ...rest
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  const go = (n: number) => onChange({ page: Math.min(Math.max(1, n), pages), size });
  return (
    <div
      className={className}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 'var(--space-2)', padding: 'var(--space-2) 0', fontSize: 13,
        color: 'var(--color-neutral-700)', ...style,
      }}
      {...rest}
    >
      <div>
        Rows per page:
        <select
          aria-label="Rows per page"
          value={size}
          onChange={(e) => onChange({ page: 1, size: Number(e.target.value) })}
          style={{
            marginLeft: 8, padding: '4px 24px 4px 8px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-neutral-300)', background: '#fff',
            fontSize: 13, color: 'var(--color-neutral-900)',
          }}
        >
          {sizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ marginLeft: 16 }}>
          {total === 0 ? '0 items'
            : `${(p - 1) * size + 1}-${Math.min(p * size, total)} of ${total}`}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          aria-label="Previous page"
          disabled={p <= 1}
          onClick={() => go(p - 1)}
          style={btn(p <= 1)}
        >
          ‹
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1).slice(
          Math.max(0, p - 3), Math.max(0, p - 3) + 5,
        ).map((n) => (
          <button
            key={n}
            type="button"
            aria-current={n === p ? 'page' : undefined}
            onClick={() => go(n)}
            style={{
              ...btn(false),
              background: n === p ? 'var(--color-primary)' : '#fff',
              color: n === p ? '#fff' : 'var(--color-neutral-700)',
              borderColor: n === p ? 'var(--color-primary)' : 'var(--color-neutral-200)',
            }}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          aria-label="Next page"
          disabled={p >= pages}
          onClick={() => go(p + 1)}
          style={btn(p >= pages)}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function btn(disabled: boolean): React.CSSProperties {
  return {
    minWidth: 32, height: 32, padding: '0 8px',
    borderRadius: 'var(--radius-sm)',
    background: '#fff',
    border: '1px solid var(--color-neutral-200)',
    color: 'var(--color-neutral-700)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontSize: 13, fontWeight: 600,
  };
}
