/**
 * AdminCleanupPage — data lifecycle & purge management.
 * Current cleanup job progress card, history table, retention policy
 * configuration (days slider, excluded entity types, frequency dropdown),
 * and a "Run Cleanup Now" action confirmed via ConfirmDialog.
 */
import { useState } from 'react';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Switch from '@/components/ui/Switch';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import CleanupProgressCard from '@/components/shared/CleanupProgressCard';

const FREQ_OPTS = [
  { label: 'Weekly (Sunday 02:00 UTC)', value: 'weekly' },
  { label: 'Every 14 days', value: 'biweekly' },
  { label: 'Monthly (1st of month)', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
];
const EXCLUDE_TYPES = [
  'Organization', 'User', 'AuditLog', 'DecisionRecord',
  'Customer', 'Product', 'Supplier', 'Market',
];

const STATUS_TO_BADGE: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'default'> = {
  running:   'primary',
  success:   'success',
  queued:    'warning',
  failed:    'danger',
  cancelled: 'default',
};

const TRIGGER_POOL = ['system-scheduler', 'alex.chen', 'priya.s', 'marcus.b', 'api-cron-worker'];

export default function AdminCleanupPage() {
  const [retentionDays, setRetentionDays] = useState(90);
  const [excluded, setExcluded] = useState<string[]>(['User', 'AuditLog']);
  const [frequency, setFrequency] = useState('weekly');
  const [autoRun, setAutoRun] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<'running' | 'queued' | 'success' | 'failed' | 'cancelled'>('success');
  const [currentProcessed, setCurrentProcessed] = useState(28_412);
  const [currentTotal, setCurrentTotal] = useState(28_412);

  const history = mockList(
    (i, r) => {
      const statuses: Array<'running' | 'queued' | 'success' | 'failed' | 'cancelled'> =
        ['success', 'success', 'success', 'success', 'failed', 'cancelled', 'queued'];
      const s = statuses[i % statuses.length];
      const days = i;
      const d = new Date();
      d.setDate(d.getDate() - days);
      const dur = `${10 + Math.floor(r * 80)}m ${Math.floor(r * 60)}s`;
      const deleted = s === 'success' ? (12_000 + Math.floor(r * 30_000)) : (s === 'failed' ? Math.floor(r * 8_000) : 0);
      return {
        taskId: `CLN-${String(2026000 + i)}`,
        triggeredBy: TRIGGER_POOL[Math.floor(r * TRIGGER_POOL.length)],
        startedAt: d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        duration: dur,
        deleted,
        status: s,
      };
    }, 10, 17,
  );

  const toggleExclude = (t: string) => setExcluded((arr) =>
    arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t],
  );

  const runNow = () => {
    setTriggering(true);
    setTimeout(() => {
      setCurrentStatus('running');
      setCurrentProcessed(0);
      setCurrentTotal(32_180);
      let p = 0;
      const h = setInterval(() => {
        p += 1_200;
        if (p >= 32_180) {
          p = 32_180;
          setCurrentProcessed(p);
          setCurrentStatus('success');
          clearInterval(h);
        } else {
          setCurrentProcessed(p);
        }
      }, 280);
      setTriggering(false);
      setDialogOpen(false);
    }, 500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Data cleanup & retention
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Configure retention policies, schedule automatic purges of stale
            graph data, and trigger manual cleanup when needed.
          </p>
        </div>
        <Button
          variant="danger"
          disabled={triggering || currentStatus === 'running'}
          onClick={() => setDialogOpen(true)}
        >
          ▶ Run cleanup now
        </Button>
      </div>

      {/* Current progress */}
      <CleanupProgressCard
        title="Current / most recent cleanup run"
        status={currentStatus}
        processed={currentProcessed}
        total={currentTotal}
      />

      {/* Two columns */}
      <div className="g12">
        {/* History table */}
        <Card style={{ gridColumn: 'span 8' }}>
          <CardHeader>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Cleanup history</h2>
            <Badge tone="info">{history.length} runs</Badge>
          </CardHeader>
          <CardContent style={{ padding: 0 }}>
            <Table style={{ border: 'none', borderRadius: 0 }}>
              <TableHeader>
                <TableCell header>Task ID</TableCell>
                <TableCell header>Triggered By</TableCell>
                <TableCell header>Started</TableCell>
                <TableCell header>Duration</TableCell>
                <TableCell header align="right">Deleted</TableCell>
                <TableCell header>Status</TableCell>
              </TableHeader>
              <tbody>
                {history.map((h) => (
                  <TableRow key={h.taskId}>
                    <TableCell>
                      <code style={{
                        fontSize: 12, background: 'var(--color-neutral-100)',
                        padding: '2px 6px', borderRadius: 4,
                      }}>
                        {h.taskId}
                      </code>
                    </TableCell>
                    <TableCell style={{ fontWeight: 500 }}>{h.triggeredBy}</TableCell>
                    <TableCell>{h.startedAt}</TableCell>
                    <TableCell style={{ color: 'var(--color-neutral-600)', fontSize: 13 }}>{h.duration}</TableCell>
                    <TableCell align="right" style={{ fontWeight: 600 }}>{h.deleted.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TO_BADGE[h.status]}>
                        {h.status.charAt(0).toUpperCase() + h.status.slice(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        {/* Policy config */}
        <Card style={{ gridColumn: 'span 4' }}>
          <CardHeader>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Cleanup policy</h2>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label style={lbl}>Retention window</label>
                <strong style={{ fontSize: 14 }}>{retentionDays} days</strong>
              </div>
              <input
                type="range"
                min={7}
                max={365}
                step={1}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)', marginTop: 8 }}
              />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, color: 'var(--color-neutral-500)', marginTop: 4,
              }}>
                <span>7 days</span>
                <span>90 days</span>
                <span>365 days</span>
              </div>
            </div>

            <div>
              <label style={lbl}>Excluded entity types</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {EXCLUDE_TYPES.map((t) => {
                  const on = excluded.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleExclude(t)}
                      style={{
                        padding: '4px 10px', borderRadius: 999,
                        border: `1px solid ${on ? 'var(--color-danger)' : 'var(--color-neutral-200)'}`,
                        background: on ? '#FBE8E7' : '#fff',
                        color: on ? 'var(--color-danger)' : 'var(--color-neutral-700)',
                        fontSize: 12,
                        fontWeight: on ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {on ? '🛇 ' : '✓ '}{t}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 8 }}>
                Excluded types will never be purged regardless of age.
              </div>
            </div>

            <div>
              <label style={lbl}>Cleanup frequency</label>
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value)} options={FREQ_OPTS} />
            </div>

            <div style={{
              padding: '10px 12px',
              background: 'var(--color-neutral-50)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-neutral-200)',
            }}>
              <Switch
                label="Enable automatic scheduled cleanup"
                checked={autoRun}
                onChange={(e) => setAutoRun(e.target.checked)}
              />
            </div>

            <Button variant="outline">💾 Save policy</Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={dialogOpen}
        title="Run data cleanup now?"
        confirmTone="danger"
        confirmLabel="Yes, purge stale data"
        onCancel={() => setDialogOpen(false)}
        onConfirm={runNow}
      >
        <p>
          You are about to delete all graph entities and records older than{' '}
          <strong>{retentionDays} days</strong>, except for{' '}
          <strong>{excluded.length} excluded type{excluded.length === 1 ? '' : 's'}</strong>.
        </p>
        <p style={{ marginTop: 8 }}>
          A backup snapshot will be created automatically before purge begins.
          This operation is not reversible from the UI (contact support with
          the snapshot ID to request a restore).
        </p>
      </ConfirmDialog>
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--color-neutral-700)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
