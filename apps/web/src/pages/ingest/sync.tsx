/**
 * IngestSyncPage — data-source connection & sync scheduling.
 * Top: connected sources grid (DataSourceIcon + name + type + status + last sync + actions).
 * Middle: add-source form (name, type, URL, auth, test-connection).
 * Bottom: sync schedule (cron expression, timezone, enable Switch).
 */
import { useState } from 'react';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Switch from '@/components/ui/Switch';
import Badge from '@/components/ui/Badge';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import DataSourceIcon, { DataSourceKind } from '@/components/shared/DataSourceIcon';
import IconButton from '@/components/ui/IconButton';

type SourceStatus = 'healthy' | 'syncing' | 'error' | 'paused';

interface Source {
  id: string;
  name: string;
  kind: DataSourceKind;
  status: SourceStatus;
  lastSync: string;
  nextSync: string;
  url: string;
}

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
  const [sources, setSources] = useState<Source[]>(() => mockList(
    (i, r) => {
      const kinds: DataSourceKind[] = ['csv', 'json', 'parquet', 'webhook'];
      const statuses: SourceStatus[] = ['healthy', 'healthy', 'syncing', 'paused', 'error', 'healthy'];
      const names = [
        'Sales Ops Drop', 'CRM Events API', 'Data Lake Parquet', 'Signup Webhook',
        'Finance CSV', 'Pricing JSON API',
      ];
      const urls = [
        's3://acme-sales/daily/',
        'https://crm.acme.ai/api/v1/events',
        's3://acme-lake/ontodecide/v1/',
        'https://hooks.ontodecide.ai/w/0x42',
        's3://acme-fin/exports/',
        'https://pricing.acme.ai/api/feed',
      ];
      return {
        id: `SRC-${String(100 + i)}`,
        name: names[i % names.length],
        kind: kinds[i % kinds.length],
        status: statuses[i % statuses.length],
        lastSync: `Aug ${18 - i}, ${new Date().getHours() - i}:${String((i * 7) % 60).padStart(2, '0')}`,
        nextSync: `in ${Math.max(1, Math.floor(r * 59))} min`,
        url: urls[i % urls.length],
      };
    }, 6, 51,
  ));
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Add form state
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DataSourceKind>('json');
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState('bearer');

  // Schedule state
  const [cron, setCron] = useState('0 */6 * * *');
  const [tz, setTz] = useState('UTC');
  const [scheduleOn, setScheduleOn] = useState(true);

  const testConnection = () => {
    setTimeout(() => {
      setTestResult({ ok: true, msg: 'Connection succeeded. Latency 98ms, auth valid.' });
    }, 700);
  };

  const addSource = () => {
    if (!name.trim() || !url.trim()) return;
    const id = `SRC-${200 + sources.length + 1}`;
    setSources((arr) => [{
      id, name, kind, url,
      status: 'healthy',
      lastSync: 'just now',
      nextSync: cron,
    }, ...arr]);
    setName(''); setUrl('');
    setTestResult({ ok: true, msg: `Source "${name}" added and queued for first sync.` });
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

      {/* Connected sources */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Connected sources</h2>
          <Badge tone="info">{sources.length} active</Badge>
        </CardHeader>
        <CardContent>
          <div className="g12">
            {sources.map((s) => {
              const meta = STATUS_META[s.status];
              return (
                <div key={s.id} style={{ gridColumn: 'span 6' }}>
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
                          }}>{s.id}</code>
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
                      <span>Last sync: <strong style={{ color: 'var(--color-neutral-700)' }}>{s.lastSync}</strong></span>
                      <span>Next: <strong style={{ color: 'var(--color-neutral-700)' }}>{s.nextSync}</strong></span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <IconButton variant="ghost" size="sm" aria-label="Sync now">⟳</IconButton>
                      <IconButton variant="ghost" size="sm" aria-label="Edit">✏️</IconButton>
                      <IconButton variant="ghost" size="sm" aria-label="Delete" style={{ color: 'var(--color-danger)' }}>🗑</IconButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
              <Select value={auth} onChange={(e) => setAuth(e.target.value)} options={AUTH_OPTIONS} />
            </div>
          </div>

          {testResult && (
            <Alert tone={testResult.ok ? 'success' : 'danger'} title={testResult.ok ? 'Test successful' : 'Test failed'} onClose={() => setTestResult(null)}>
              {testResult.msg}
            </Alert>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="outline" onClick={testConnection}>🧪 Test connection</Button>
            <Button variant="primary" onClick={addSource}>+ Connect source</Button>
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
              <Select value={tz} onChange={(e) => setTz(e.target.value)} options={TZ_OPTIONS} disabled={!scheduleOn} />
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                Next 5 runs will be computed in the selected zone.
              </div>
            </div>
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
