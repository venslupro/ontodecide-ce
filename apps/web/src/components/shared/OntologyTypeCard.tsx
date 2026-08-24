/**
 * OntologyTypeCard — node type tile: name, id, property count, relation count.
 */
import { HTMLAttributes, ReactNode } from 'react';
import Badge from '@/components/ui/Badge';

export interface OntologyTypeCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id'> {
  name: ReactNode;
  id: ReactNode;
  propertyCount: number;
  relationCount: number;
  color?: string;
}

export default function OntologyTypeCard({
  name, id, propertyCount, relationCount, color = 'var(--color-primary)',
  className = '', style, ...rest
}: OntologyTypeCardProps) {
  return (
    <div
      className={className}
      style={{
        background: '#fff', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-neutral-200)',
        boxShadow: 'var(--shadow-sm)', padding: 'var(--space-3)',
        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
        borderLeft: `4px solid ${color}`, ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
          {name}
        </h3>
        <code style={{
          fontSize: 11, color: 'var(--color-neutral-500)',
          background: 'var(--color-neutral-100)', padding: '2px 6px',
          borderRadius: 4,
        }}>
          {id}
        </code>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Badge tone="primary">Properties · {propertyCount}</Badge>
        <Badge tone="info">Relations · {relationCount}</Badge>
      </div>
    </div>
  );
}
