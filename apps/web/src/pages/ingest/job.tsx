/**
 * IngestJobPage — job detail page, reads :id from the URL.
 * Sections: header (title, id, status Badge), progress bar with steps,
 * phase list (Parse → Validate → Enrich → Ingest → Index) each with
 * status badge + timing + record count, scrollable log panel,
 * action bar (cancel / retry / download result).
 */
import { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import Progress from '@/components/ui/Progress';
import Badge from '@/components/ui/Badge';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

type JobStatus = 'processing' | 'success' | 'failed' | 'queued' | 'cancelled';
const STATUS_META: Record<JobStatus, { tone: 'primary' | 'success' | 'danger' | 'warning' | 'default'; label: string }> = {
  processing: { tone: 'primary', label: 'Processing' },
  success:    { tone: 'success', label: 'Success' },
  failed:     { tone: 'danger',  label: 'Failed' },
  queued:     { tone: 'warning', label: 'Queued' },
  cancelled:  { tone: 'default', label: 'Cancelled' },
};

interface Stage {
  name: 'Parse' | 'Validate' | 'Enrich' | 'Ingest' | 'Index';
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  startedAt: string;
  endedAt?: string;
  rows: number;
  note?: string;
}

const STAGE_NAMES: Stage['name'][] = ['Parse', 'Validate', 'Enrich', 'Ingest', 'Index'];
const STAGE_COLORS: Record<Stage['status'], string> = {
  pending:   'var(--color-neutral-300)',
  running:   'var(--color-primary)',
  success:   'var(--color-success)',
  failed:    'var(--color-danger)',
  skipped:   'var(--color-neutral-500)',
};

const LOG_LINES = [
  '[08:42:01] JOB  — ingest job 2026-08-24/ING-4821 started (runner=worker-03).',
  '[08:42:01] CONF — source=s3://acme-sales/daily/customers_sept.csv (type=csv).',
  '[08:42:02] PARSE — reading 420 KB from object store (4,382 lines incl. header).',
  '[08:42:02] PARSE — detected delimiter "," header columns=14, quotes=double.',
  '[08:42:03] PARSE — 4,381 rows, 0 malformed lines detected.',
  '[08:42:03] VALIDATE — running 6 schema rules + 2 uniqueness constraints.',
  '[08:42:04] VALIDATE — 4,377 passed (99.91%), 4 rows flagged as soft-warnings.',
  '[08:42:04] VALIDATE — WARN customer_email nullable set contains 87 nulls.',
  '[08:42:05] ENRICH — resolve company names to ont:Organization (toposort).',
  '[08:42:06] ENRICH — linked 3,204 rows to known identities (73.2%).',
  '[08:42:07] ENRICH — geocoded 2,881 addresses with HQ coordinates.',
  '[08:42:08] INGEST — upsert entities (batch=256, parallelism=4).',
  '[08:42:09] INGEST — batch 1/17 completed ok (retries=0).',
  '[08:42:13] INGEST — batch 12/17 completed ok (retries=1).',
  '[08:42:15] INGEST — 4,377 rows inserted, 4 merged into existing.',
  '[08:42:16] INDEX — notify search indexer (async kafka topic=ingest-completed).',
  '[08:42:17] INDEX — offset 0x42a91f acknowledged by indexer.',
  '[08:42:17] JOB  — finished OK (16.245s elapsed, cpu=5.2s, peak mem=218MB).',
];

export default function IngestJobPage() {
  const { id = 'ING-4821' } = useParams();
  const navigate = useNavigate();
  // Derive a deterministic status from the id
  const hash = (parseInt(id.replace(/\D/g, ''), 10) || 4821) % 3;
  const statuses: JobStatus[] = ['processing', 'success', 'failed'];
  const status = statuses[hash];
  const meta = STATUS_META[status];

  const [progress, setProgress] = useState<number>(() => (
    status === 'success' ? 100 : status === 'failed' ? 78 : 62
  ));

  useEffect(() => {
    if (status !== 'processing') return;
    const t = setInterval(() => {
      setProgress((p) => Math.min(99, p + 1));
    }, 2200);
    return () => clearInterval(t);
  }, [status]);

  const stages: Stage[] = useMemo(() => {
    const order: Stage['status'][] = status === 'success'
      ? ['success', 'success', 'success', 'success', 'success']
      : status === 'failed'
      ? ['success', 'success', 'success', 'failed', 'pending']
      : ['success', 'success', 'running', 'pending', 'pending'];
    return STAGE_NAMES.map((n, i) => ({
      name: n,
      status: order[i],
      startedAt: `08:4${Math.floor(i * 0.3)}:0${i + 1}`,
      endedAt: order[i] === 'success' || order[i] === 'failed' ? `08:4${Math.floor((i + 1) * 0.5)}:0${i + 3}` : undefined,
      rows: [4381, 4377, 3204, 4377, 4377][i],
      note: order[i] === 'failed' ? 'Connection refused from downstream indexer — see log line 17.' : undefined,
    }));
  }, [status]);

  const completedStages = stages.filter((s) => s.status === 'success').length;

  const [showCancel, setShowCancel] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Header */}
      <Card>
        <CardContent style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 'var(--space-3)', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, flexShrink: 0,
              background: meta.tone === 'success' ? '#E8F5EC' :
                meta.tone === 'danger' ? '#FBE8E7' :
                meta.tone === 'warning' ? '#FBF3DC' : 'var(--color-primary-50)',
              color: meta.tone === 'success' ? 'var(--color-success)' :
                meta.tone === 'danger' ? 'var(--color-danger)' :
                meta.tone === 'warning' ? 'var(--color-warning)' : 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26,
            }}>⚙️</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
                  Ingest job · customers_sept.csv
                </h1>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--color-neutral-500)' }}>
                <span>Job ID: <code style={{
                  background: 'var(--color-neutral-100)', padding: '2px 6px',
                  borderRadius: 4, fontSize: 12,
                }}>{id}</code></span>
                <span>Started: <strong style={{ color: 'var(--color-neutral-700)' }}>Aug 24, 08:42:01</strong></span>
                <span>Elapsed: <strong style={{ color: 'var(--color-neutral-700)' }}>16.2s</strong></span>
                <span>Runner: <code style={{
                  background: 'var(--color-neutral-100)', padding: '2px 6px',
                  borderRadius: 4, fontSize: 12,
                }}>worker-03</code></span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="md" onClick={() => navigate(-1)}>← Back</Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => status === 'failed' ? setProgress(0) : undefined}
            >⟳ Retry</Button>
            <Button variant="outline" size="md">⬇ Download result</Button>
            {status === 'processing' && (
              <Button variant="danger" size="md" onClick={() => setShowCancel(true)}>✕ Cancel</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Progress card */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Overall progress</h2>
          <Badge tone="info">{completedStages} of {stages.length} stages</Badge>
        </CardHeader>
        <CardContent>
          <Progress value={progress} tone={meta.tone as 'success' | 'danger' | 'primary'} showLabel label="Job progress" />
          <div style={{
            marginTop: 'var(--space-2)',
            display: 'flex', justifyContent: 'space-between',
            fontSize: 12, color: 'var(--color-neutral-500)',
          }}>
            <span>Rows processed: <strong style={{ color: 'var(--color-neutral-900)' }}>{stages[3].rows.toLocaleString('en-US')}</strong></span>
            <span>Estimated remaining: <strong style={{ color: 'var(--color-neutral-900)' }}>{status === 'success' ? '—' : '~ 6s'}</strong></span>
          </div>
        </CardContent>
      </Card>

      {/* Stages */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Pipeline stages</h2>
        </CardHeader>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stages.map((s, i) => (
            <div
              key={s.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '48px 160px 1fr auto auto',
                gap: 14,
                alignItems: 'center',
                padding: '14px 16px',
                background: s.status === 'failed' ? '#FBE8E7' : s.status === 'running' ? 'var(--color-primary-50)' : 'var(--color-neutral-50)',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${s.status === 'failed' ? '#F3C9C8' : s.status === 'running' ? '#D4C7FC' : 'var(--color-neutral-200)'}`,
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 13,
                background: STAGE_COLORS[s.status],
              }}>{i + 1}</div>
              <div style={{ fontWeight: 700, color: 'var(--color-neutral-900)', fontSize: 14 }}>
                {s.name}
              </div>
              <div>
                {s.note ? (
                  <div style={{ color: 'var(--color-danger)', fontSize: 13, fontWeight: 500 }}>{s.note}</div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                    {s.startedAt} → {s.endedAt ?? (s.status === 'running' ? 'running…' : '—')}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                {s.status === 'pending' ? '—' : <><strong>{s.rows.toLocaleString('en-US')}</strong> rows</>}
              </div>
              <Badge tone={
                s.status === 'success' ? 'success' :
                s.status === 'running' ? 'primary' :
                s.status === 'failed' ? 'danger' :
                s.status === 'skipped' ? 'default' : 'warning'
              }>
                {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Log panel */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Job logs</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" size="sm">⟳ Tail</Button>
            <Button variant="outline" size="sm">⬇ Download logs</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{
            background: 'var(--color-neutral-900)',
            color: '#E5E7EB',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            maxHeight: 320,
            overflow: 'auto',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <pre style={{
              margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {LOG_LINES.map((l, i) => {
                const color = l.includes('WARN') ? '#FBF3DC' :
                  l.includes('FAIL') || l.includes('refused') ? '#F3C9C8' :
                  l.startsWith('[') ? '#D4C7FC' : '#E5E7EB';
                return (
                  <div key={i} style={{ color }}>{l}</div>
                );
              })}
            </pre>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showCancel}
        title="Cancel this job?"
        confirmTone="danger"
        confirmLabel="Cancel job"
        onCancel={() => setShowCancel(false)}
        onConfirm={() => {
          setShowCancel(false);
          navigate(-1);
        }}
      >
        <p>
          Any completed stages will be kept; in-progress writes will be rolled
          back. This action cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
