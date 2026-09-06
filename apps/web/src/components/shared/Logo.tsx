/**
 * Logo — OntoDecide brand mark.
 *
 * Combines two domain concepts:
 *   - a hexagon node (ontology / knowledge-graph unit)
 *   - a checkmark path formed by connected dots (decision / reasoning)
 *
 * Rendered as an inline SVG so it scales crisply at any size and inherits
 * no external image dependency. The gradient mirrors the login-page
 * brand gradient (purple → blue).
 */

export interface LogoProps {
  /** Pixel size of the square logo mark. */
  size?: number;
  /** Render only the mark (no wordmark). */
  markOnly?: boolean;
  /** Mark color scheme: gradient (default) or light (for dark backgrounds). */
  tone?: 'gradient' | 'light';
  /** Override the wordmark color. */
  color?: string;
  className?: string;
}

export default function Logo({
  size = 32,
  markOnly = false,
  tone = 'gradient',
  color = 'var(--color-neutral-900)',
  className = '',
}: LogoProps) {
  const stroke = tone === 'light' ? '#ffffff' : 'url(#od-logo-grad)';
  const fillOpacity = tone === 'light' ? '0.2' : '0.16';
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        role="img"
        aria-label="OntoDecide"
      >
        <defs>
          <linearGradient id="od-logo-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7b5ce0" />
            <stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        {/* Hexagon node — the ontology unit. */}
        <path
          d="M24 3 L41 12.5 V35.5 L24 45 L7 35.5 V12.5 Z"
          fill={tone === 'light' ? '#ffffff' : 'url(#od-logo-grad)'}
          opacity={fillOpacity}
        />
        <path
          d="M24 3 L41 12.5 V35.5 L24 45 L7 35.5 V12.5 Z"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        {/* Decision checkmark — the outcome of reasoning. */}
        <path
          d="M15 24.5 L21 31 L33 18"
          stroke={stroke}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Graph nodes — the knowledge connections. */}
        <circle cx="15" cy="24.5" r="2.6" fill={tone === 'light' ? '#fff' : '#7b5ce0'} />
        <circle cx="21" cy="31" r="2.6" fill={tone === 'light' ? '#fff' : '#3b82f6'} />
        <circle cx="33" cy="18" r="2.6" fill={tone === 'light' ? '#fff' : '#3b82f6'} />
      </svg>
      {!markOnly ? (
        <span
          style={{
            fontWeight: 700,
            fontSize: Math.round(size * 0.55),
            letterSpacing: '-0.01em',
            color,
            lineHeight: 1,
          }}
        >
          OntoDecide
        </span>
      ) : null}
    </span>
  );
}
