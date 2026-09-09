/**
 * DashboardPage — default landing page after login.
 * Sections: welcome banner, 4 KPI tiles, 6 ontology type cards,
 * recent decisions table + quick actions card. All data deterministic
 * via mockList(seeded).
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { mockList } from '@/lib/mock';
import KpiCard from '@/components/shared/KpiCard';
import OntologyTypeCard from '@/components/shared/OntologyTypeCard';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Tag from '@/components/ui/Tag';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';

/** Colour cycle for ontology-type card left borders. */
const ONTO_COLORS = [
  'var(--color-primary)',
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-primary)',
];

const ONTO_NAMES = [
  { name: 'Organization', id: 'ont:org' },
  { name: 'Product', id: 'ont:product' },
  { name: 'Customer', id: 'ont:customer' },
  { name: 'Market', id: 'ont:market' },
  { name: 'Supplier', id: 'ont:supplier' },
  { name: 'Regulation', id: 'ont:regulation' },
];

/** Build a sparkline array from a seeded random. */
function spark(seed: number): number[] {
  const out: number[] = [];
  let s = seed >>> 0;
  for (let i = 0; i < 12; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push((s >>> 8) / 0xffffff);
  }
  return out;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const userName = session?.username ?? session?.user_id ?? 'Alex';
  const tenantId = session?.tenant_id ?? 'tenant-acme-001';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // 4 KPI tiles (static values matching spec + deterministic sparklines).
  const kpis = [
    {
      label: 'Total Entities', value: '1,284',
      delta: { value: '+12.4%', tone: 'positive' as const, label: 'vs last month' },
      sparkline: spark(11),
      iconNode: (
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="7" ry="3" stroke="var(--color-primary)" strokeWidth="1.8" />
          <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" stroke="var(--color-primary)" strokeWidth="1.8" />
          <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" stroke="var(--color-primary)" strokeWidth="1.8" />
        </svg>
      ),
      iconAlt: 'Entities icon',
      iconTileBg: 'var(--color-primary-50)',
    },
    {
      label: 'Ontology Types', value: '18',
      delta: { value: '+2', tone: 'positive' as const, label: 'new this week' },
      sparkline: spark(22),
      iconNode: (
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="5" r="2.5" fill="var(--color-accent)" />
          <circle cx="6" cy="18" r="2.5" fill="var(--color-accent)" />
          <circle cx="18" cy="18" r="2.5" fill="var(--color-accent)" />
          <path d="M12 7.5L7 15.5M12 7.5L17 15.5" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
      iconAlt: 'Ontology icon',
      iconTileBg: 'var(--color-accent-50)',
    },
    {
      label: 'Decisions Run', value: '342',
      delta: { value: '+8.1%', tone: 'positive' as const, label: 'vs last week' },
      sparkline: spark(33),
      iconNode: (
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" stroke="var(--color-success)" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      iconAlt: 'Decision icon',
      iconTileBg: 'var(--color-success-50)',
    },
    {
      label: 'Acceptance Rate', value: '76%',
      delta: { value: '-2.3%', tone: 'negative' as const, label: 'vs last period' },
      sparkline: spark(44),
      iconNode: (
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="var(--color-warning)" strokeWidth="1.8" />
          <path d="M12 7v5l3 2" stroke="var(--color-warning)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      iconAlt: 'Acceptance icon',
      iconTileBg: 'var(--color-warning-50)',
    },
  ];

  // 6 Ontology cards (deterministic via mockList)
  const ontologies = mockList(
    (i, r) => ({
      name: ONTO_NAMES[i % ONTO_NAMES.length].name,
      id: ONTO_NAMES[i % ONTO_NAMES.length].id,
      propertyCount: 4 + Math.floor(r * 14),
      relationCount: 2 + Math.floor(r * 10),
      color: ONTO_COLORS[i % ONTO_COLORS.length],
    }),
    6, 7,
  );

  // Recent decisions (10 rows, truncated to preview)
  const decisions = mockList(
    (i, r) => {
      const types = ['Scenario', 'Recommendation', 'Situation', 'Simulation'];
      const titles = [
        'Q4 Inventory Resize',
        'US Market Expansion',
        'Vendor Contract Renewal',
        'Pricing Strategy Shift',
        'New Product Launch Plan',
        'Logistics Route Optimize',
        'Compliance Risk Review',
        'Demand Forecast Refresh',
        'M&A Candidate Shortlist',
        'Capacity Planning',
      ];
      const confidence = 60 + Math.floor(r * 40);
      const statuses = [
        { label: 'Completed', tone: 'success' as const },
        { label: 'Running', tone: 'primary' as const },
        { label: 'Pending', tone: 'warning' as const },
        { label: 'Failed', tone: 'danger' as const },
      ];
      const st = statuses[Math.floor(r * statuses.length)];
      const daysAgo = Math.floor(r * 20);
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return {
        id: `DEC-${String(1000 + i)}`,
        title: titles[i % titles.length],
        type: types[i % types.length],
        confidence,
        status: st,
        created: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
    },
    10, 13,
  );

  const quickActions = useMemo(() => [
    { label: 'Upload Data', icon: '📤', href: '#/ingest/file', desc: 'CSV / JSON / Parquet files' },
    { label: 'Explore Graph', icon: '🕸', href: '#/graph/explore', desc: 'Visual navigation' },
    { label: 'Run Scenario', icon: '🎲', href: '#/decisions/scenario', desc: 'Multi-outcome simulate' },
    { label: 'Ask Agent', icon: '🤖', href: '#/decisions/agent', desc: 'AI guided analysis' },
  ], []);

  const quickLinks = [
    { label: 'Ontology Types', href: '#/graph/ontology' },
    { label: 'Entity Browser', href: '#/graph/entities' },
    { label: 'Sync Connections', href: '#/ingest/sync' },
    { label: 'Recommendations', href: '#/decisions/recommend' },
    { label: 'Audit Logs', href: '#/admin/audit' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Welcome banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%)',
          borderRadius: 'var(--radius-lg)',
          color: '#fff',
          padding: 'var(--space-4)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-3)', flexWrap: 'wrap',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{today}</div>
          <h1 style={{
            fontSize: 24, fontWeight: 700, color: '#fff',
            letterSpacing: '-0.01em',
          }}>
            Welcome back, {userName} 👋
          </h1>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            Tenant: <code style={{
              background: 'rgba(255,255,255,0.18)', padding: '2px 8px',
              borderRadius: 4, fontSize: 12,
            }}>{tenantId}</code>
          </div>
        </div>
        <Button variant="secondary" size="md" onClick={() => navigate('/decisions/agent')}>
          Start new decision →
        </Button>
      </div>

      {/* KPI row */}
      <div className="g12">
        {kpis.map((k, i) => (
          <div key={i} style={{ gridColumn: 'span 3' }}>
            <KpiCard {...k} />
          </div>
        ))}
      </div>

      {/* Ontology grid */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
            Ontology overview
          </h2>
          <Button variant="outline" size="sm" onClick={() => navigate('/graph/ontology')}>
            View all →
          </Button>
        </CardHeader>
        <CardContent>
          <div className="g12">
            {ontologies.map((o, i) => (
              <div key={i} style={{ gridColumn: 'span 4' }}>
                <OntologyTypeCard
                  name={o.name}
                  id={o.id}
                  propertyCount={o.propertyCount}
                  relationCount={o.relationCount}
                  color={o.color}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lower two columns */}
      <div className="g12">
        {/* Recent decisions */}
        <Card style={{ gridColumn: 'span 8' }}>
          <CardHeader>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
              Recent decisions
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/decisions/scenario')}>
              Open decisions →
            </Button>
          </CardHeader>
          <CardContent style={{ padding: 0 }}>
            <Table style={{ border: 'none', borderRadius: 0 }}>
              <TableHeader>
                <TableCell header>Title</TableCell>
                <TableCell header>Type</TableCell>
                <TableCell header>Confidence</TableCell>
                <TableCell header>Status</TableCell>
                <TableCell header>Created</TableCell>
              </TableHeader>
              <tbody>
                {decisions.slice(0, 6).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 600, color: 'var(--color-neutral-900)' }}>
                          {d.title}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                          {d.id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Tag tone="neutral">{d.type}</Tag>
                    </TableCell>
                    <TableCell>
                      <span style={{ fontWeight: 600 }}>{d.confidence}%</span>
                    </TableCell>
                    <TableCell>
                      <Badge tone={d.status.tone}>{d.status.label}</Badge>
                    </TableCell>
                    <TableCell>{d.created}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card style={{ gridColumn: 'span 4' }}>
          <CardHeader>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
              Quick actions
            </h2>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
                gap: 'var(--space-2)',
              }}
            >
              {quickActions.map((qa) => (
                <a
                  key={qa.label}
                  href={qa.href}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 4, padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-neutral-50)',
                    border: '1px solid var(--color-neutral-200)',
                    textDecoration: 'none',
                    transition: 'all .15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--color-primary)';
                    (e.currentTarget as HTMLAnchorElement).style.background = 'var(--color-primary-50)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--color-neutral-200)';
                    (e.currentTarget as HTMLAnchorElement).style.background = 'var(--color-neutral-50)';
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 22 }}>{qa.icon}</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-neutral-900)', fontSize: 13 }}>
                    {qa.label}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                    {qa.desc}
                  </span>
                </a>
              ))}
            </div>
            <div style={{
              paddingTop: 'var(--space-2)',
              borderTop: '1px solid var(--color-neutral-200)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-neutral-700)', marginBottom: 8 }}>
                Shortcuts
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {quickLinks.map((l) => (
                  <Tag key={l.label} tone="primary">
                    <a href={l.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {l.label}
                    </a>
                  </Tag>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
