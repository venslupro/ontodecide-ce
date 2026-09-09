/**
 * IngestFilePage — file upload + webhook configuration via Tabs.
 * File tab: drag-and-drop dashed upload area, supported format chips,
 * selected file list with progress bars + remove + upload button.
 * Webhook tab: URL, signing key, event-type toggles, test send, call log.
 */
import { useState, ChangeEvent, DragEvent, useRef } from 'react';
import Tabs, { Tab } from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Switch from '@/components/ui/Switch';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Progress from '@/components/ui/Progress';
import Badge from '@/components/ui/Badge';
import Tag from '@/components/ui/Tag';
import Alert from '@/components/ui/Alert';
import IconButton from '@/components/ui/IconButton';
import DataSourceIcon from '@/components/shared/DataSourceIcon';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';

interface FileEntry {
  id: string;
  name: string;
  size: number;
  progress: number; // 0-100
  type: 'csv' | 'json' | 'parquet' | 'xml';
}

const SUPPORTED_FORMATS = [
  { label: 'CSV', color: 'var(--color-success)' },
  { label: 'JSON', color: 'var(--color-accent)' },
  { label: 'Parquet', color: 'var(--color-primary)' },
  { label: 'XML', color: 'var(--color-warning)' },
];

const EVENT_TYPES = [
  'entity.created', 'entity.updated', 'entity.deleted',
  'decision.submitted', 'recommendation.adopted', 'ingest.completed',
  'audit.event', 'alert.triggered',
];

const MOCK_CALLS = [
  { time: '08:41', event: 'entity.updated', status: 200, ms: 84 },
  { time: '08:12', event: 'decision.submitted', status: 200, ms: 132 },
  { time: '07:58', event: 'entity.created', status: 200, ms: 61 },
  { time: '07:40', event: 'ingest.completed', status: 200, ms: 209 },
  { time: '06:11', event: 'alert.triggered', status: 502, ms: 20011 },
];

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function extToType(name: string): FileEntry['type'] {
  const n = name.toLowerCase();
  if (n.endsWith('.csv')) return 'csv';
  if (n.endsWith('.json') || n.endsWith('.jsonl')) return 'json';
  if (n.endsWith('.parquet') || n.endsWith('.pq')) return 'parquet';
  return 'xml';
}

export default function IngestFilePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
          File & webhook ingestion
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
          Drop structured files or configure a webhook endpoint to stream
          events directly into the knowledge graph.
        </p>
      </div>

      <Card>
        <CardHeader style={{ paddingBottom: 0, borderBottom: 'none' }}>
          <Tabs defaultValue="file">
            <Tab value="file" label="File upload">
              <FileUploadTab />
            </Tab>
            <Tab value="webhook" label="Webhook">
              <WebhookTab />
            </Tab>
          </Tabs>
        </CardHeader>
        <CardContent style={{ padding: 0 }} />
      </Card>
    </div>
  );
}

function FileUploadTab() {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([
    { id: 'f1', name: 'customers_sept.csv', size: 420_320, progress: 100, type: 'csv' },
    { id: 'f2', name: 'pricing_feed.jsonl', size: 1_842_991, progress: 72, type: 'json' },
    { id: 'f3', name: 'inventory_snapshot.parquet', size: 12_290_821, progress: 0, type: 'parquet' },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const arr: FileEntry[] = Array.from(list).map((f, i) => ({
      id: `f${Date.now()}_${i}`,
      name: f.name,
      size: f.size,
      progress: 0,
      type: extToType(f.name),
    }));
    setFiles((cur) => [...cur, ...arr]);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const remove = (id: string) => setFiles((arr) => arr.filter((f) => f.id !== id));

  const uploadAll = () => {
    setNote('Upload queued. Processing will begin momentarily…');
    // Simulate progress
    let tick = 0;
    const handle = setInterval(() => {
      tick += 1;
      setFiles((arr) => arr.map((f) => ({
        ...f,
        progress: Math.min(100, f.progress + (f.progress === 100 ? 0 : f.progress === 0 ? 22 : 12)),
      })));
      if (tick > 8) clearInterval(handle);
    }, 300);
    setTimeout(() => setNote(null), 3200);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        aria-label="Upload files by dropping or clicking"
        style={{
          cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 10,
          padding: 'var(--space-6) var(--space-4)',
          borderRadius: 'var(--radius-lg)',
          border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-neutral-300)'}`,
          background: dragOver ? 'var(--color-primary-50)' : 'var(--color-neutral-50)',
          transition: 'all .15s ease',
          textAlign: 'center',
        }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'var(--color-primary-50)',
          color: 'var(--color-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28,
        }}>📤</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
          Drop files here or click to browse
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>
          Supported formats:
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            {SUPPORTED_FORMATS.map((f) => (
              <Tag key={f.label} tone="neutral">
                <span aria-hidden="true" style={{
                  display: 'inline-block', width: 8, height: 8,
                  borderRadius: '50%', background: f.color, marginRight: 6,
                }} />
                {f.label}
              </Tag>
            ))}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.json,.jsonl,.parquet,.pq,.xml"
          style={{ display: 'none' }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            addFiles(e.target.files);
            // Reset the input value so selecting the same file again
            // still triggers onChange.
            e.target.value = '';
          }}
        />
      </div>

      {note && <Alert tone="success" onClose={() => setNote(null)}>{note}</Alert>}

      <Card style={{ border: '1px solid var(--color-neutral-200)' }}>
        <CardHeader>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>Selected files ({files.length})</h3>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {files.length === 0 ? (
              <div style={{ padding: 'var(--space-4)', textAlign: 'center', fontSize: 13, color: 'var(--color-neutral-500)' }}>
                No files selected yet.
              </div>
            ) : (
              files.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr 40px',
                    gap: 12,
                    alignItems: 'center',
                    padding: '14px var(--space-3)',
                    borderBottom: '1px solid var(--color-neutral-200)',
                  }}
                >
                  <DataSourceIcon kind={f.type === 'xml' ? 'csv' : f.type} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-neutral-900)', fontSize: 14 }}>
                        {f.name}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-500)', flexShrink: 0 }}>
                        {fmtBytes(f.size)}
                      </span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Progress value={f.progress} tone={f.progress === 100 ? 'success' : 'primary'} showLabel label="Upload progress" />
                    </div>
                  </div>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label="Remove file"
                    onClick={() => remove(f.id)}
                    style={{ color: 'var(--color-danger)' }}
                  >
                    🗑
                  </IconButton>
                </div>
              ))
            )}
          </div>
        </CardContent>
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderTop: '1px solid var(--color-neutral-200)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            Total: {fmtBytes(files.reduce((s, f) => s + f.size, 0))} across {files.length} file{files.length === 1 ? '' : 's'}.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setFiles([])}>Clear</Button>
            <Button variant="primary" size="sm" onClick={uploadAll} disabled={files.length === 0}>
              ⬆ Upload files
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function WebhookTab() {
  const [url, setUrl] = useState('https://hooks.ontodecide.ai/w/5f4a2e…');
  const [secret, setSecret] = useState('whsec_7eFf1aA9…');
  const [events, setEvents] = useState<string[]>([
    'entity.created', 'entity.updated', 'decision.submitted', 'ingest.completed',
  ]);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);

  const toggleEvent = (e: string) => setEvents((arr) =>
    arr.includes(e) ? arr.filter((x) => x !== e) : [...arr, e],
  );
  const regenerate = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = 'whsec_';
    for (let i = 0; i < 28; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setSecret(s);
    setTestResult({ ok: true, msg: 'New signing secret generated. Update it at your provider.' });
  };
  const testSend = () => {
    setTimeout(() => setTestResult({ ok: true, msg: 'Test event delivered in 92 ms · 200 OK' }), 500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="g12">
        <Card style={{ gridColumn: 'span 6', margin: 0 }}>
          <CardHeader>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Endpoint</h3>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div>
              <label style={lbl}>Webhook URL</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} leftIcon={<span>🔗</span>} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label style={lbl}>Signing secret</label>
                <button type="button" onClick={regenerate} style={{
                  fontSize: 12, color: 'var(--color-primary)', fontWeight: 600,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                }}>
                  🔄 Regenerate
                </button>
              </div>
              <Input value={secret} leftIcon={<span>🔐</span>} readOnly />
            </div>
            <div>
              <label style={lbl}>Test delivery</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="outline" onClick={testSend}>📨 Send test event</Button>
                <Badge tone="primary">{events.length} enabled events</Badge>
              </div>
            </div>
            {testResult && (
              <Alert tone={testResult.ok ? 'success' : 'danger'} title={testResult.ok ? 'Delivered' : 'Failed'} onClose={() => setTestResult(null)}>
                {testResult.msg}
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card style={{ gridColumn: 'span 6', margin: 0 }}>
          <CardHeader>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Event subscriptions</h3>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {EVENT_TYPES.map((e) => {
                const checked = events.includes(e);
                return (
                  <label
                    key={e}
                    htmlFor={`ev-${e}`}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 12px',
                      background: 'var(--color-neutral-50)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-neutral-200)',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--color-neutral-900)', fontSize: 13 }}>
                        {e}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                        Fires when {e} occurs.
                      </div>
                    </div>
                    <Switch
                      id={`ev-${e}`}
                      name={e}
                      checked={checked}
                      onChange={() => toggleEvent(e)}
                    />
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Call log */}
      <Card>
        <CardHeader>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>Recent webhook calls</h3>
          <Badge tone="info">Last 24h</Badge>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          <Table style={{ border: 'none', borderRadius: 0 }}>
            <TableHeader>
              <TableCell header>Time</TableCell>
              <TableCell header>Event</TableCell>
              <TableCell header align="right">Status</TableCell>
              <TableCell header align="right">Duration</TableCell>
            </TableHeader>
            <tbody>
              {MOCK_CALLS.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{c.time}</TableCell>
                  <TableCell>
                    <Tag tone={i === 4 ? 'primary' : 'neutral'}>{c.event}</Tag>
                  </TableCell>
                  <TableCell align="right">
                    <Badge tone={c.status >= 500 ? 'danger' : c.status >= 400 ? 'warning' : 'success'}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell align="right">
                    <span style={{ color: 'var(--color-neutral-600)', fontSize: 13 }}>{c.ms} ms</span>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
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
