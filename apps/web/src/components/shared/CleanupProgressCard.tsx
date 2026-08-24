/**
 * CleanupProgressCard — summary card for admin cleanup jobs.
 * Shows status pill, linear progress, processed/total counts and error banner.
 */
import { HTMLAttributes, ReactNode } from 'react';
import Badge, { BadgeTone } from '@/components/ui/Badge';
import Progress from '@/components/ui/Progress';
import Alert from '@/components/ui/Alert';

export type CleanupStatus =
  | 'running' | 'queued' | 'success' | 'failed' | 'cancelled';

export interface CleanupProgressCardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  status: CleanupStatus;
  processed: number;
  total: number;
  errorMessage?: string | null;
}

const statusMeta: Record<CleanupStatus, { tone: BadgeTone; label: string }> = {
  running:   { tone: 'primary', label: 'Running' },
  queued:    { tone: 'warning', label: 'Queued' },
  success:   { tone: 'success', label: 'Success' },
  failed:    { tone: 'danger',  label: 'Failed' },
  cancelled: { tone: 'default', label: 'Cancelled' },
};

export default function CleanupProgressCard({
  title = 'Cleanup job progress', status, processed, total, errorMessage,
  className = '', style, ...rest
}: CleanupProgressCardProps) {
  const pct = total <= 0 ? 0 : Math.min(100, Math.round((processed / total) * 100));
  const meta = statusMeta[status];
  const tone: 'primary' | 'success' | 'warning' | 'danger' =
    status === 'success' ? 'success' :
    status === 'failed' ? 'danger' :
    status === 'queued' ? 'warning' : 'primary';

  return (
    <div
      className={className}
      style={{
        background: '#fff', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-neutral-200)',
        boxShadow: 'var(--shadow-sm)', padding: 'var(--space-3)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        ...style,
      }}
      {...rest}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 'var(--space-2)',
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
          {title}
        </h3>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <Progress value={pct} tone={tone} showLabel />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 13, color: 'var(--color-neutral-500)',
      }}>
        <span>Processed: <strong style={{ color: 'var(--color-neutral-900)' }}>{processed}</strong></span>
        <span>Total: <strong style={{ color: 'var(--color-neutral-900)' }}>{total}</strong></span>
      </div>
      {errorMessage ? (
        <Alert tone="danger" title="Cleanup failed">{errorMessage}</Alert>
      ) : null}
    </div>
  );
}
