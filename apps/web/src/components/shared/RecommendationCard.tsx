/**
 * RecommendationCard — AI recommendation tile with priority ribbon,
 * confidence ring, rationale text and action steps.
 */
import { HTMLAttributes, ReactNode } from 'react';
import ProgressRing from '@/components/ui/ProgressRing';
import Tag from '@/components/ui/Tag';

export type RecommendationPriority = 'high' | 'medium' | 'low';

export interface RecommendationStep {
  label: ReactNode;
  description?: ReactNode;
}
export interface RecommendationCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  priority: RecommendationPriority;
  confidence: number;        /** 0-100 */
  rationale: ReactNode;
  steps: RecommendationStep[];
}

const priMeta: Record<RecommendationPriority, { label: string; bg: string; fg: string }> = {
  high:   { label: 'High priority',   bg: 'var(--color-danger)',  fg: '#fff' },
  medium: { label: 'Medium priority', bg: 'var(--color-warning)', fg: '#fff' },
  low:    { label: 'Low priority',    bg: 'var(--color-accent)',  fg: '#fff' },
};

export default function RecommendationCard({
  title, priority, confidence, rationale, steps,
  className = '', style, ...rest
}: RecommendationCardProps) {
  const pm = priMeta[priority];
  return (
    <div
      className={className}
      style={{
        position: 'relative', background: '#fff',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-neutral-200)',
        boxShadow: 'var(--shadow-sm)', padding: 'var(--space-3)',
        paddingTop: 'calc(var(--space-3) + 8px)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        minWidth: 0, overflow: 'hidden', ...style,
      }}
      {...rest}
    >
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '6px var(--space-3)', fontSize: 12, fontWeight: 700,
          background: pm.bg, color: pm.fg, letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}
        role="banner"
        aria-label={`Priority: ${pm.label}`}
      >
        {pm.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <ProgressRing
          value={confidence}
          tone={
            priority === 'high' ? 'danger' :
            priority === 'medium' ? 'warning' : 'primary'
          }
          size={56}
          strokeWidth={5}
          aria-label={`Confidence ${confidence}%`}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
            {title}
          </h3>
          <p style={{
            fontSize: 14, color: 'var(--color-neutral-700)',
            lineHeight: 1.6, marginTop: 4,
          }}>
            {rationale}
          </p>
        </div>
      </div>
      <div>
        <h4 style={{
          fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-700)',
          marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          Recommended steps
        </h4>
        <ol style={{
          margin: 0, paddingLeft: 20,
          fontSize: 14, color: 'var(--color-neutral-700)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {steps.map((s, i) => (
            <li key={i}>
              <strong style={{ color: 'var(--color-neutral-900)' }}>{s.label}</strong>
              {s.description ? (
                <span style={{ color: 'var(--color-neutral-500)' }}> — {s.description}</span>
              ) : null}
              {s.description ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}><Tag tone="primary">Step {i + 1}</Tag></div> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
