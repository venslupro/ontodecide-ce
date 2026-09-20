/**
 * IngestSyncPage — data-source connection & sync scheduling.
 * Top: connected sources grid (DataSourceIcon + name + type + status + last sync + actions).
 * Middle: add-source form (name, type, URL, auth, test-connection).
 * Bottom: sync schedule (cron expression, timezone, enable Switch).
 */
import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Switch from '@/components/ui/Switch';
import Badge from '@/components/ui/Badge';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import DataSourceIcon, { DataSourceKind } from '@/components/shared/DataSourceIcon';
import IconButton from '@/components/ui/IconButton';
import * as ingestionResource from '@/services/api/ingestionResource';

type SourceStatus = 'healthy' | 'syncing' | 'error' | 'paused';

type Source = ingestionResource.DataSource;

const KIND_LABELS: Record<DataSourceKind, string> = {
  csv: 'CSV Drop',
  json: 'JSON API',
  parquet: 'Parquet Lake',
  webhook: 'Webhook Stream',
};

const STATUS_META: Record<SourceStatus, { tone: 'success' | 'primary' | 'danger' | 'warning' | 'default'; label: string }> = {
  healthy: { tone: 'success', label: 'Healthy' },
  syncing: { tone: 'primary', label: 'Syncing…' },
  error: { tone: 'danger', label: 'Error' },
  paused: { tone: 'warning', label: 'Paused' },
};

const KIND_OPTIONS = [
  { label: 'CSV Drop', value: 'csv' },
  { label: 'JSON API', value: 'json' },
  { label: 'Parquet Lake', value: 'parquet' },
  { label: 'Webhook Stream', value: 'webhook' },
];
const AUTH_OPTIONS = [
  { label: 'None (public)', value: 'none' },
  { label: 'Bearer token', value: 'bearer' },
  { label: 'Basic auth', value: 'basic' },
  { label: 'OAuth 2.0 (client credentials)', value: 'oauth' },
];
const TZ_OPTIONS = [
  { label: 'UTC', value: 'UTC' },
  { label: 'America/New_York (EST)', value: 'America/New_York' },
  { label: 'Europe/London (GMT)', value: 'Europe/London' },
  { label: 'Europe/Berlin (CET)', value: 'Europe/Berlin' },
  { label: 'Asia/Shanghai (CST)', value: 'Asia/Shanghai' },
  { label: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
];

export default function IngestSyncPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Add form state
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DataSourceKind>('json');
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState('bearer');

  // Schedule state
  const [cron, setCron] = useState('0 */6 * * *');
  const [tz, setTz] = useState('UTC');
  const [scheduleOn, setScheduleOn] = useState(true);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await ingestionResource.listSources();
    if (result.success && result.data) {
      setSources(result.data);
    } else {
      setError(result.error?.message ?? 'Failed to load sources.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const testConnection = async () => {
    if (!url.trim()) {
      setTestResult({ ok: false, msg: 'Enter a connection URL first.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    // If the source hasn't been created yet, do a lightweight fetch.
    // Otherwise, use the backend test endpoint.
    const existing = sources.find((s) => s.url === url.trim());
    if (existing) {
      const result = await ingestionResource.testSource(existing.sourceId);
      if (result.success && result.data) {
        setTestResult({
          ok: result.data.ok,
          msg: result.data.ok
            ? `Connection succeeded. Latency ${result.data.latencyMs}ms.`
            : `Connection failed: ${result.data.message}`,
        });
      } else {
        setTestResult({
          ok: false,
          msg: result.error?.message ?? 'Test failed.',
        });
      }
    } else {
      // For unsaved URLs, attempt a direct HEAD request.
      try {
        const start = Date.now();
        const res = await fetch(url.trim(), { method: 'HEAD' });
        const latency = Date.now() - start;
        setTestResult({
          ok: res.ok,
          msg: res.ok
            ? `Connection succeeded. Latency ${latency}ms.`
            : `Connection failed: HTTP ${res.status}`,
        });
      } catch (err) {
        setTestResult({
          ok: false,
          msg: err instanceof Error ? err.message : 'Connection failed.',
        });
      }
    }
    setTesting(false);
  };

  const addSource = async () => {
    if (!name.trim() || !url.trim()) return;
    const result = await ingestionResource.createSource({
      name: name.trim(),
      kind,
      url: url.trim(),
      auth,
      cron,
      timezone: tz,
      scheduleEnabled: scheduleOn,
    });
    if (result.success && result.data) {
      setSources((arr) => [result.data as Source, ...arr]);
      setName('');
      setUrl('');
      setTestResult({ ok: true, msg: `Source "${name}" added.` });
    } else {
      setTestResult({
        ok: false,
        msg: result.error?.message ?? 'Failed to add source.',
      });
    }
  };

  const removeSource = async (id: string) => {
    const result = await ingestionResource.deleteSource(id);
    if (result.success) {
      setSources((arr) => arr.filter((s) => s.sourceId !== id));
    }
  };

  const saveSchedule = async () => {
    // Update schedule for all sources (or the first one if only one exists).
    if (sources.length === 0) return;
    const first = sources[0];
    const result = await ingestionResource.updateSchedule(first.sourceId, {
      cron,
      timezone: tz,
      scheduleEnabled: scheduleOn,
    });
    if (result.success) {
      setTestResult({ ok: true, msg: 'Schedule updated.' });
    } else {
      setTestResult({
        ok: false,
        msg: result.error?.message ?? 'Failed to update schedule.',
      });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
          Data sources & sync
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
          Connect databases, APIs, object stores and webhooks. Configure
          authentication, test connectivity and schedule recurring sync jobs.
        </p>
      </div>

      {error && (
        <Alert tone="danger" title="Error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Connected sources */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Connected sources</h2>
          <Badge tone="info">{sources.length} active</Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', fontSize: 13, color: 'var(--color-neutral-500)' }}>
              Loading sources…
            </div>
          ) : sources.length === 0 ? (
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', fontSize: 13, color: 'var(--color-neutral-500)' }}>
              No sources connected yet. Use the form below to add one.
            </div>
          ) : (
            <div className="g12">
              {sources.map((s) => {
                const meta = STATUS_META[s.status];
                return (
                  <div key={s.sourceId} style={{ gridColumn: 'span 6' }}>
                    <div
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 10,
                        padding: 'var(--space-3)',
                        background: '#fff',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--color-neutral-200)',
                        boxShadow: 'var(--shadow-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                        <DataSourceIcon kind={s.kind} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontWeight: 700, color: 'var(--color-neutral-900)' }}>{s.name}</div>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                          </div>
                          <div style={{
                            fontSize: 12, color: 'var(--color-neutral-500)',
                            marginTop: 2,
                            display: 'flex', gap: 10, flexWrap: 'wrap',
                          }}>
                            <span>{KIND_LABELS[s.kind]}</span>
                            <code style={{
                              background: 'var(--color-neutral-100)',
                              padding: '1px 6px', borderRadius: 4,
                              fontSize: 11,
                            }}>{s.sourceId}</code>
                          </div>
                        </div>
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--color-neutral-600)',
                        padding: 8,
                        background: 'var(--color-neutral-50)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-neutral-200)',
                        wordBreak: 'break-all',
                      }}>
                        {s.url}
                      </div>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: 12, color: 'var(--color-neutral-500)',
                      }}>
                        <span>Last sync: <strong style={{ color: 'var(--color-neutral-700)' }}>{s.lastSync ?? '—'}</strong></span>
                        <span>Next: <strong style={{ color: 'var(--color-neutral-700)' }}>{s.nextSync ?? '—'}</strong></span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="Sync now"
                          onClick={() => void ingestionResource.testSource(s.sourceId)}
                        >⟳</IconButton>
                        <IconButton variant="ghost" size="sm" aria-label="Edit">✏️</IconButton>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="Delete"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={() => void removeSource(s.sourceId)}
                        >🗑</IconButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New source */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Connect a new source</h2>
        </CardHeader>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="g12">
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Source name</label>
              <Input placeholder="e.g. Product Events API" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Type</label>
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as DataSourceKind)}
                options={KIND_OPTIONS}
              />
            </div>
            <div style={{ gridColumn: 'span 8' }}>
              <label style={lbl}>Connection URL / endpoint</label>
              <Input
                placeholder="https://… or s3://… or gs://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                leftIcon={<span style={{ color: 'var(--color-neutral-500)' }}>🔗</span>}
              />
            </div>
            <div style={{ gridColumn: 'span 4' }}>
              <label style={lbl}>Authentication</label>
              <Select
                value={auth}
                onChange={(e) => setAuth(e.target.value)}
                options={AUTH_OPTIONS}
              />
            </div>
          </div>

          {testResult && (
            <Alert tone={testResult.ok ? 'success' : 'danger'} title={testResult.ok ? 'Test successful' : 'Test failed'} onClose={() => setTestResult(null)}>
              {testResult.msg}
            </Alert>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="outline" onClick={testConnection} disabled={testing}>
              {testing ? '⏳ Testing…' : '🧪 Test connection'}
            </Button>
            <Button variant="primary" onClick={addSource} disabled={!name.trim() || !url.trim()}>
              + Connect source
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Sync schedule</h2>
          <Switch label="Enable scheduled sync" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
        </CardHeader>
        <CardContent>
          <div className="g12">
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Cron expression</label>
              <Input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 */6 * * *"
                disabled={!scheduleOn}
              />
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                Runs every 6 hours at minute 0. Min Hour Dom Month Dow.
              </div>
            </div>
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Time zone</label>
              <Select
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                options={TZ_OPTIONS}
                disabled={!scheduleOn}
              />
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                Next 5 runs will be computed in the selected zone.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <Button variant="primary" onClick={saveSchedule} disabled={sources.length === 0}>
              Save schedule
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--color-neutral-700)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
