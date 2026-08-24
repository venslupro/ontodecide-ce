/**
 * ScenarioCard — decision scenario tile with tone badge, narrative,
 * key factor chips and a probability progress bar.
 */
import { HTMLAttributes, ReactNode } from 'react';
import Badge, { BadgeTone } from '@/components/ui/Badge';
import Tag from '@/components/ui/Tag';
import Progress from '@/components/ui/Progress';

export type ScenarioTone = 'bullish' | 'bearish' | 'neutral' | 'risky';

export interface ScenarioCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  tone: ScenarioTone;
  narrative: ReactNode;
  keyFactors: ReactNode[];
  probability: number;    /** 0-100 */
}

const toneMeta: Record<ScenarioTone, { tone: BadgeTone; label: string; bar: 'success'|'danger'|'primary'|'warning' }> = {
  bullish: { tone: 'success', label: 'Bullish', bar: 'success' },
  bearish: { tone: 'danger',  label: 'Bearish', bar: 'danger'  },
  neutral: { tone: 'default', label: 'Neutral', bar: 'primary' },
  risky:   { tone: 'warning', label: 'At risk', bar: 'warning' },
};

export default function ScenarioCard({
  title, tone, narrative, keyFactors, probability,
  className = '', style, ...rest
}: ScenarioCardProps) {
  const m = toneMeta[tone];
  return (
    <div
      className={className}
      style={{
        background: '#fff', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-neutral-200)',
        boxShadow: 'var(--shadow-sm)', padding: 'var(--space-3)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        minWidth: 0, ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
          {title}
        </h3>
        <Badge tone={m.tone}>{m.label}</Badge>
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-neutral-700)', lineHeight: 1.6 }}>
        {narrative}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {keyFactors.map((f, i) => <Tag key={i} tone="neutral">{f}</Tag>)}
      </div>
      <Progress value={probability} tone={m.bar} showLabel label="Estimated probability" />
    </div>
  );
}
