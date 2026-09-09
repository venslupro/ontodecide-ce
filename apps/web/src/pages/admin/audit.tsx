/**
 * AdminAuditPage — admin-only audit log browser.
 * Filter toolbar (date range, user, action type, resource, severity),
 * table (Time / User / Action / Resource / IP / Severity Badge),
 * clickable rows expand a detail panel with request params, response code,
 * user agent. Pagination + Export CSV CTA.
 */
import { useState, useMemo, Fragment } from 'react';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';
import Alert from '@/components/ui/Alert';

type Severity = 'info' | 'warning' | 'danger' | 'success';

interface AuditRow {
  id: string;
  time: string;
  user: string;
  action: string;
  resource: string;
  resourceType: string;
  ip: string;
  severity: Severity;
  response: number;
  params: string;
  userAgent: string;
  expanded?: boolean;
}

const ACTIONS = [
  { label: 'All actions', value: 'all' },
  { label: 'Login', value: 'login' },
  { label: 'Create', value: 'create' },
  { label: 'Update', value: 'update' },
  { label: 'Delete', value: 'delete' },
  { label: 'Download', value: 'download' },
  { label: 'Export', value: 'export' },
  { label: 'Config change', value: 'config' },
];
const RESOURCES = [
  { label: 'All resources', value: 'all' },
  { label: 'User', value: 'user' },
  { label: 'Entity', value: 'entity' },
  { label: 'Decision', value: 'decision' },
  { label: 'Config', value: 'config' },
  { label: 'Ingestion', value: 'ingest' },
  { label: 'Ontology', value: 'ontology' },
];
const SEV_OPTS = [
  { label: 'All severities', value: 'all' },
  { label: 'Info', value: 'info' },
  { label: 'Success', value: 'success' },
  { label: 'Warning', value: 'warning' },
  { label: 'Danger', value: 'danger' },
];

const SEV_COLORS: Record<Severity, 'info' | 'success' | 'warning' | 'danger' | 'primary' | 'default'> = {
  info:    'info',
  success: 'success',
  warning: 'warning',
  danger:  'danger',
};

const USERS_POOL = ['alex.chen', 'priya.s', 'marcus.b', 'fatima.a', 'jordan.k', 'sophie.l', 'diego.r'];
const ACTION_WORDS = ['login', 'create', 'update', 'update', 'delete', 'download', 'export', 'config'];
const RES_WORDS = ['user', 'entity', 'decision', 'config', 'ingest', 'ontology'];

export default function AdminAuditPage() {
  const [user, setUser] = useState('');
  const [action, setAction] = useState('all');
  const [resource, setResource] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [from, setFrom] = useState('2026-08-17');
  const [to, setTo] = useState('2026-08-24');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Generate the full audit dataset once (268 rows matching the spec total).
  const allRows: AuditRow[] = useMemo(() => mockList(
    (i, r) => {
      const sevByNum: Severity[] = ['info', 'info', 'info', 'success', 'success', 'warning', 'danger'];
      const s = sevByNum[Math.floor(r * sevByNum.length)];
      const actionWord = ACTION_WORDS[Math.floor(r * ACTION_WORDS.length)];
      const resWord = RES_WORDS[Math.floor(r * RES_WORDS.length)];
      const user = USERS_POOL[Math.floor(r * USERS_POOL.length)];
      const mins = i;
      const d = new Date(Date.now() - mins * 37 * 60 * 1000);
      return {
        id: `AUD-${String(900000 + i)}`,
        time: d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        user,
        action: `${actionWord}.${resWord}`,
        resource: `${resWord.slice(0, 3).toUpperCase()}-${1000 + Math.floor(r * 8000)}`,
        resourceType: resWord,
        ip: `10.${Math.floor(r * 255)}.${Math.floor(r * 255)}.${1 + Math.floor(r * 250)}`,
        severity: s,
        response: s === 'danger' ? (400 + Math.floor(r * 99)) : (200 + Math.floor(r * 50)),
        params: `page=${Math.floor(r * 10)}&size=50&filters=${encodeURIComponent(resWord + ',active')}`,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
      } as AuditRow;
    }, 268, 404,
  ), []);

  // Apply toolbar filters.
  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      const matchesUser = !user.trim() || row.user.toLowerCase().includes(user.trim().toLowerCase());
      const matchesAction = action === 'all' || row.action.startsWith(action);
      const matchesResource = resource === 'all' || row.resourceType === resource;
      const matchesSeverity = severity === 'all' || row.severity === severity;
      return matchesUser && matchesAction && matchesResource && matchesSeverity;
    });
  }, [allRows, user, action, resource, severity]);

  const total = filteredRows.length;
  const rows = useMemo(() => {
    const start = (page - 1) * size;
    return filteredRows.slice(start, start + size);
  }, [filteredRows, page, size]);

  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const exportCsv = () => {}; // placeholder

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Audit log
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            All administrative and security-relevant actions captured with
            caller identity, resource, IP and full request context.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv}>⬇ Export CSV</Button>
      </div>

      <Card>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 'var(--space-2)' }}>
            <div>
              <label style={lbl}>From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>User</label>
              <Input placeholder="e.g. alex.chen" value={user} onChange={(e) => setUser(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Action</label>
              <Select value={action} onChange={(e) => setAction(e.target.value)} options={ACTIONS} />
            </div>
            <div>
              <label style={lbl}>Resource</label>
              <Select value={resource} onChange={(e) => setResource(e.target.value)} options={RESOURCES} />
            </div>
            <div>
              <label style={lbl}>Severity</label>
              <Select value={severity} onChange={(e) => setSeverity(e.target.value)} options={SEV_OPTS} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => {
              setUser(''); setAction('all'); setResource('all'); setSeverity('all'); setPage(1);
            }}>Clear filters</Button>
            <Button variant="primary" size="sm">🔍 Apply filters</Button>
          </div>
          <Alert tone="info" title="Tip">
            Click any row to reveal the full request context including query
            parameters, HTTP response code and the caller user-agent string.
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardContent style={{ padding: 0 }}>
          <Table style={{ border: 'none', borderRadius: 0 }}>
            <TableHeader>
              <TableCell header style={{ width: 32 }}></TableCell>
              <TableCell header>Time</TableCell>
              <TableCell header>User</TableCell>
              <TableCell header>Action</TableCell>
              <TableCell header>Resource</TableCell>
              <TableCell header>IP</TableCell>
              <TableCell header>Severity</TableCell>
            </TableHeader>
            <tbody>
              {rows.map((r) => {
                const open = expanded.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <TableRow
                      onClick={() => toggle(r.id)}
                      style={{
                        cursor: 'pointer',
                        background: open ? 'var(--color-primary-50)' : undefined,
                      }}
                    >
                      <TableCell>
                        <span
                          aria-hidden="true"
                          style={{
                            display: 'inline-block',
                            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform .15s ease',
                            color: 'var(--color-neutral-500)',
                          }}
                        >▶</span>
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>{r.time}</TableCell>
                      <TableCell>
                        <code style={{
                          fontSize: 12,
                          background: 'var(--color-neutral-100)',
                          padding: '2px 6px', borderRadius: 4,
                        }}>{r.user}</code>
                      </TableCell>
                      <TableCell style={{ fontWeight: 600 }}>{r.action}</TableCell>
                      <TableCell>
                        <div>
                          <span>{r.resource}</span>
                          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{r.resourceType}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--color-neutral-600)' }}>
                          {r.ip}
                        </span>
                      </TableCell>
                      <TableCell><Badge tone={SEV_COLORS[r.severity]}>{r.severity.toUpperCase()}</Badge></TableCell>
                    </TableRow>
                    {open && (
                      <tr aria-label="details">
                        <td colSpan={7} style={{
                          padding: '0 var(--space-3) var(--space-3)',
                          background: 'var(--color-primary-50)',
                        }}>
                          <div style={{
                            padding: 'var(--space-3)',
                            background: '#fff',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid #D4C7FC',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                            gap: 'var(--space-3)',
                          }}>
                            <div>
                              <div style={lbl2}>Event ID</div>
                              <div style={mono2}>{r.id}</div>
                            </div>
                            <div>
                              <div style={lbl2}>Response code</div>
                              <div style={mono2}>
                                <Badge tone={r.response >= 500 ? 'danger' : r.response >= 400 ? 'warning' : 'success'}>
                                  HTTP {r.response}
                                </Badge>
                              </div>
                            </div>
                            <div>
                              <div style={lbl2}>IP address</div>
                              <div style={mono2}>{r.ip}</div>
                            </div>
                            <div style={{ gridColumn: 'span 3' }}>
                              <div style={lbl2}>Request parameters</div>
                              <pre style={pre2}><code>?{r.params}</code></pre>
                            </div>
                            <div style={{ gridColumn: 'span 3' }}>
                              <div style={lbl2}>User-Agent</div>
                              <pre style={pre2}><code>{r.userAgent}</code></pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
          <div style={{ padding: '0 var(--space-3)' }}>
            <Pagination
              page={page}
              size={size}
              total={total}
              onChange={({ page: p, size: s }) => { setPage(p); setSize(s); setExpanded(new Set()); }}
            />
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
const lbl2: React.CSSProperties = {
  fontSize: 11, fontWeight: 700,
  color: 'var(--color-neutral-500)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  marginBottom: 4,
};
const mono2: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace', fontSize: 13,
  color: 'var(--color-neutral-900)',
};
const pre2: React.CSSProperties = {
  margin: 0, padding: 10,
  background: 'var(--color-neutral-900)',
  color: '#F9FAFB',
  borderRadius: 6, fontSize: 12,
  fontFamily: 'ui-monospace, monospace',
  lineHeight: 1.55, overflowX: 'auto',
  border: '1px solid rgba(255,255,255,0.08)',
};
