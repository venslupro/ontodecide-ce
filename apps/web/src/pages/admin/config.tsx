/**
 * AdminConfigPage — grouped system configuration.
 * Section cards: Authentication, Storage, AI, Notifications. Each card
 * has form inputs and its own Save Changes button. Top export/import CTAs.
 */
import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Switch from '@/components/ui/Switch';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';

const PROVIDER_OPTS = [
  { label: 'OntoDecide AI (default)', value: 'ontodecide' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Azure OpenAI', value: 'azure' },
  { label: 'Self-hosted (Ollama)', value: 'ollama' },
];
const MODEL_OPTS = [
  { label: 'gpt-decision-4o (recommended)', value: 'gpt-d-4o' },
  { label: 'gpt-decision-turbo', value: 'gpt-d-turbo' },
  { label: 'claude-decision-3.5', value: 'cl-d-35' },
  { label: 'decision-lite', value: 'd-lite' },
];
const FREQ_OPTS = [
  { label: 'Daily (recommended)', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'On important events only', value: 'important' },
  { label: 'Never', value: 'never' },
];
const CHANNEL_OPTS = [
  { label: 'Email', value: 'email' },
  { label: 'Slack', value: 'slack' },
  { label: 'MS Teams', value: 'teams' },
  { label: 'Webhook', value: 'webhook' },
  { label: 'In-app only', value: 'inapp' },
];
const LIFECYCLE_OPTS = [
  { label: '30 days', value: '30' },
  { label: '60 days', value: '60' },
  { label: '90 days (recommended)', value: '90' },
  { label: '180 days', value: '180' },
  { label: '1 year', value: '365' },
  { label: 'Indefinite', value: 'indef' },
];

export default function AdminConfigPage() {
  const [toast, setToast] = useState<string | null>(null);
  const [jwtTtl, setJwtTtl] = useState('24h');
  const [pwdMin, setPwdMin] = useState('12');
  const [mfa, setMfa] = useState(false);

  const [bucket, setBucket] = useState('ontodecide-storage-prod');
  const [region, setRegion] = useState('us-central-1');
  const [lifecycle, setLifecycle] = useState('90');

  const [provider, setProvider] = useState('ontodecide');
  const [model, setModel] = useState('gpt-d-4o');
  const [budget, setBudget] = useState('2500');
  const [cacheTtl, setCacheTtl] = useState('30m');

  const [emailOn, setEmailOn] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('https://hooks.acme.ai/ontodecide');
  const [frequency, setFrequency] = useState('daily');
  const [channels, setChannels] = useState<string[]>(['email', 'slack']);
  const toggleChannel = (c: string) => setChannels((arr) =>
    arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c],
  );

  const save = (group: string) => {
    setToast(`${group} configuration saved successfully.`);
    setTimeout(() => setToast(null), 2400);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            System configuration
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Tenant-wide controls for authentication, storage, AI behaviour and
            notification delivery. Changes are versioned and auditable.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline">⬆ Import config</Button>
          <Button variant="secondary">⬇ Export config</Button>
        </div>
      </div>

      {toast && (
        <Alert tone="success" title="Saved" onClose={() => setToast(null)}>{toast}</Alert>
      )}

      {/* Auth */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={iconBadge('#FBF3DC', 'var(--color-warning)')}>🔐</div>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>Authentication</h2>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                Session, password, and second-factor controls.
              </div>
            </div>
          </div>
          <Badge tone="primary">Global</Badge>
        </CardHeader>
        <CardContent>
          <div className="g12">
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>JWT access token TTL</label>
              <Input value={jwtTtl} onChange={(e) => setJwtTtl(e.target.value)} />
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                Accepts suffixes: m (minutes), h (hours), d (days).
              </div>
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Password min length</label>
              <Input type="number" min={8} max={128} value={pwdMin} onChange={(e) => setPwdMin(e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Multi-factor</label>
              <div style={{ padding: '10px 12px', background: 'var(--color-neutral-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-neutral-200)' }}>
                <Switch label="Enforce MFA for all users" checked={mfa} onChange={(e) => setMfa(e.target.checked)} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" onClick={() => save('Authentication')}>💾 Save changes</Button>
          </div>
        </CardContent>
      </Card>

      {/* Storage */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={iconBadge('var(--color-accent-50)', 'var(--color-accent)')}>☁️</div>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>Storage</h2>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                Object storage location and retention.
              </div>
            </div>
          </div>
          <Badge tone="info">B2 · S3 compat</Badge>
        </CardHeader>
        <CardContent>
          <div className="g12">
            <div style={{ gridColumn: 'span 5' }}>
              <label style={lbl}>B2 Bucket name</label>
              <Input value={bucket} onChange={(e) => setBucket(e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Region</label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 4' }}>
              <label style={lbl}>Lifecycle (days)</label>
              <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} options={LIFECYCLE_OPTS} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" onClick={() => save('Storage')}>💾 Save changes</Button>
          </div>
        </CardContent>
      </Card>

      {/* AI */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={iconBadge('var(--color-primary-50)', 'var(--color-primary)')}>🤖</div>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>AI</h2>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                Model, provider, budget, and caching.
              </div>
            </div>
          </div>
          <Badge tone="primary">Models · cached</Badge>
        </CardHeader>
        <CardContent>
          <div className="g12">
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Default AI provider</label>
              <Select value={provider} onChange={(e) => setProvider(e.target.value)} options={PROVIDER_OPTS} />
            </div>
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Default model</label>
              <Select value={model} onChange={(e) => setModel(e.target.value)} options={MODEL_OPTS} />
            </div>
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Monthly budget (USD)</label>
              <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} leftIcon={<span>$</span>} />
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                Hard cap — AI requests will be throttled when this is reached.
              </div>
            </div>
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Response cache TTL</label>
              <Input value={cacheTtl} onChange={(e) => setCacheTtl(e.target.value)} />
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                Set to <code style={{ fontSize: 11, background: 'var(--color-neutral-100)', padding: '1px 4px', borderRadius: 4 }}>0</code> to disable caching.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" onClick={() => save('AI')}>💾 Save changes</Button>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={iconBadge('#E8F5EC', 'var(--color-success)')}>🔔</div>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>Notifications</h2>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                Where and how alerts are delivered.
              </div>
            </div>
          </div>
          <Badge tone="success">Delivered</Badge>
        </CardHeader>
        <CardContent>
          <div className="g12">
            <div style={{ gridColumn: 'span 4' }}>
              <label style={lbl}>Email notifications</label>
              <div style={{ padding: '10px 12px', background: 'var(--color-neutral-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-neutral-200)' }}>
                <Switch label="Enable email digest" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
              </div>
            </div>
            <div style={{ gridColumn: 'span 8' }}>
              <label style={lbl}>Webhook URL</label>
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} leftIcon={<span>🔗</span>} />
            </div>
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Digest frequency</label>
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value)} options={FREQ_OPTS} />
            </div>
            <div style={{ gridColumn: 'span 6' }}>
              <label style={lbl}>Active channels</label>
              <div style={{
                padding: '10px 12px', background: 'var(--color-neutral-50)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-neutral-200)',
                display: 'flex', flexWrap: 'wrap', gap: 8,
              }}>
                {CHANNEL_OPTS.map((c) => {
                  const on = channels.includes(c.value);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => toggleChannel(c.value)}
                      style={{
                        padding: '6px 12px', borderRadius: 999,
                        border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-neutral-300)'}`,
                        background: on ? 'var(--color-primary-50)' : '#fff',
                        color: on ? 'var(--color-primary)' : 'var(--color-neutral-700)',
                        fontSize: 12, fontWeight: on ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <Button variant="primary" onClick={() => save('Notifications')}>💾 Save changes</Button>
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

function iconBadge(bg: string, fg: string): React.CSSProperties {
  return {
    width: 40, height: 40, borderRadius: 10,
    background: bg, color: fg, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20,
  };
}
