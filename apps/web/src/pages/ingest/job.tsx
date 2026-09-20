/**
 * IngestJobPage — job detail page, reads :id from the URL.
 * Fetches real job data from GET /api/ingest/jobs/:id and displays
 * status, progress, record counts, and error details.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import Progress from '@/components/ui/Progress';
import Badge from '@/components/ui/Badge';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import * as ingestionResource from '@/services/api/ingestionResource';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

const STATUS_META: Record<JobStatus, { tone: 'primary' | 'success' | 'danger' | 'warning'; label: string }> = {
  queued: { tone: 'warning', label: 'Queued' },
  running: { tone: 'primary', label: 'Running' },
  succeeded: { tone: 'success', label: 'Success' },
  failed: { tone: 'danger', label: 'Failed' },
};

/** Progress percentage derived from the job status. */
function statusToProgress(status: JobStatus): number {
  switch (status) {
    case 'queued': return 10;
    case 'running': return 60;
    case 'succeeded': return 100;
    case 'failed': return 0;
  }
}

export default function IngestJobPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [job, setJob] = useState<ingestionResource.IngestJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    if (!id) {
      setError('No job id provided.');
      setLoading(false);
      return;
    }
    const result = await ingestionResource.getJob(id);
    if (result.success && result.data) {
      setJob(result.data);
      setError(null);
    } else {
      setError(result.error?.message ?? 'Failed to load job.');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void fetchJob();
  }, [fetchJob]);

  // Poll for updates while the job is in a non-terminal state.
  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    const interval = setInterval(() => void fetchJob(), 5000);
    return () => clearInterval(interval);
  }, [job, fetchJob]);

  const status: JobStatus = job?.status ?? 'queued';
  const meta = STATUS_META[status];
  const progress = statusToProgress(status);
  const accepted = job?.accepted ?? 0;
  const rejected = job?.rejected ?? 0;
  const total = accepted + rejected;

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
                  Ingest job
                </h1>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>
              <div style={{
                display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                fontSize: 13, color: 'var(--color-neutral-500)',
              }}>
                <span>Job ID: <code style={{
                  background: 'var(--color-neutral-100)', padding: '2px 6px',
                  borderRadius: 4, fontSize: 12,
                }}>{id}</code></span>
                {job?.startedAt && (
                  <span>Started: <strong style={{ color: 'var(--color-neutral-700)' }}>
                    {new Date(job.startedAt).toLocaleString('en-US')}
                  </strong></span>
                )}
                {job?.finishedAt && (
                  <span>Finished: <strong style={{ color: 'var(--color-neutral-700)' }}>
                    {new Date(job.finishedAt).toLocaleString('en-US')}
                  </strong></span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="md" onClick={() => navigate(-1)}>← Back</Button>
            {status === 'failed' && (
              <Button
                variant="outline"
                size="md"
                onClick={() => void fetchJob()}
              >⟳ Retry</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error banner */}
      {error && (
        <Alert tone="danger" title="Error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Job error detail */}
      {job?.error && (
        <Alert tone="danger" title="Job failed">
          {job.error}
        </Alert>
      )}

      {/* Progress card */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Overall progress</h2>
          {job && (
            <Badge tone="info">
              {job.format.toUpperCase()} · {job.ontologyType}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>
              Loading job details…
            </div>
          ) : (
            <>
              <Progress
                value={progress}
                tone={meta.tone as 'success' | 'danger' | 'primary'}
                showLabel
                label="Job progress"
              />
              <div style={{
                marginTop: 'var(--space-2)',
                display: 'flex', justifyContent: 'space-between',
                fontSize: 12, color: 'var(--color-neutral-500)',
              }}>
                <span>Records accepted: <strong style={{ color: 'var(--color-neutral-900)' }}>{accepted.toLocaleString('en-US')}</strong></span>
                <span>Records rejected: <strong style={{ color: 'var(--color-neutral-900)' }}>{rejected.toLocaleString('en-US')}</strong></span>
                <span>Total: <strong style={{ color: 'var(--color-neutral-900)' }}>{total.toLocaleString('en-US')}</strong></span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Source info */}
      {job && (
        <Card>
          <CardHeader>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Source details</h2>
          </CardHeader>
          <CardContent>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 'var(--space-2)',
            }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>Format</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{job.format.toUpperCase()}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>Ontology type</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{job.ontologyType}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>Object key</div>
              <div style={{
                fontWeight: 600, fontSize: 13, wordBreak: 'break-all',
                fontFamily: 'ui-monospace, monospace',
              }}>{job.objectKey}</div>
            </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
