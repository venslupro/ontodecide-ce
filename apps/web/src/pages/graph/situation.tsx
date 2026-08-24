/**
 * GraphSituationPage — situation / event detail.
 * Reads :id from URL, renders a header card with status + entity count,
 * an AgentTimeline of evolution steps, a key-factor tag wall,
 * and a bottom recommendations + export section.
 */
import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Tag from '@/components/ui/Tag';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import AgentTimeline, { AgentTask } from '@/components/shared/AgentTimeline';
import RecommendationCard from '@/components/shared/RecommendationCard';

const STATUS_POOL: Array<{ label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'default' }> = [
  { label: 'Resolved', tone: 'success' },
  { label: 'Active', tone: 'primary' },
  { label: 'Monitoring', tone: 'info' },
  { label: 'Escalated', tone: 'warning' },
  { label: 'Contained', tone: 'success' },
];

export default function GraphSituationPage() {
  const { id = 'SIT-2026-0042' } = useParams();
  const navigate = useNavigate();
  const statusIdx = (parseInt(id.replace(/\D/g, ''), 10) || 42) % STATUS_POOL.length;
  const status = STATUS_POOL[statusIdx];

  const entityCount = 18 + (statusIdx * 3);

  // Deterministic timeline
  const timelineTasks: AgentTask[] = useMemo(() => mockList(
    (i, _r) => {
      const all: AgentTask[] = [
        { label: 'Signal detected from data stream', status: 'success', start: '08:12', end: '08:13', result: 'Anomaly score spiked above threshold 0.85 (was 0.32).' },
        { label: 'Correlated entities extracted', status: 'success', start: '08:13', end: '08:15', result: 'Found 14 affected entities across 3 ontology types.' },
        { label: 'Situation classified', status: 'success', start: '08:15', end: '08:16', result: 'Classified as "supply-risk" (confidence 89%).' },
        { label: 'Root cause analysis', status: 'running', start: '08:16', result: 'Running causal search across 3-hop neighbourhood…' },
        { label: 'Mitigation options generated', status: 'pending', result: 'Awaiting RCA before recommending actions.' },
        { label: 'Notify stakeholders', status: 'pending' },
      ];
      return all[Math.min(i, all.length - 1)];
    }, 6, 99 + statusIdx,
  ), [statusIdx]);

  // Key factors
  const factors = mockList(
    (i, r) => {
      const words = [
        'Port Congestion', 'Supplier Reliability', 'Fuel Cost Volatility',
        'Regulatory Change', 'Demand Shift', 'Seasonality',
        'Currency Risk', 'Capacity Crunch', 'Labor Shortage',
        'Material Shortage', 'Competitor Move', 'Weather Event',
      ];
      return words[(i + Math.floor(r * 3)) % words.length];
    }, 10, 14,
  );

  // Related recommendations (2 cards)
  const recs = [
    {
      title: 'Activate backup vendor (VN Tier-1)',
      priority: 'high' as const,
      confidence: 86,
      rationale: 'Primary supplier lead-time has doubled over 14 days; activating Tier-1 backup reduces stock-out risk by 62%.',
      steps: [
        { label: 'Route open POs to backup vendor', description: 'Estimated shift: 42% of current pipeline.' },
        { label: 'Rebalance warehouse safety stock', description: 'Raise EU-West buffer by 18%.' },
        { label: 'Notify downstream planning', description: 'Align with demand-ops within 24 hours.' },
      ],
    },
    {
      title: 'Renegotiate SLA terms with carrier',
      priority: 'medium' as const,
      confidence: 71,
      rationale: 'Carrier on-time delivery dropped 11 pts; a targeted SLA renegotiation with penalty clauses is projected to recover 7 pts.',
      steps: [
        { label: 'Compile breach evidence', description: 'Last 45 days of lane-level performance.' },
        { label: 'Schedule commercial review', description: 'With carrier account lead + legal.' },
        { label: 'Agree revised SLA + credits' },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Header card */}
      <Card>
        <CardContent style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 'var(--space-3)', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, flexShrink: 0,
              background: status.tone === 'danger' ? '#FBE8E7' :
                status.tone === 'warning' ? '#FBF3DC' :
                status.tone === 'success' ? '#E8F5EC' : 'var(--color-primary-50)',
              color: status.tone === 'danger' ? 'var(--color-danger)' :
                status.tone === 'warning' ? 'var(--color-warning)' :
                status.tone === 'success' ? 'var(--color-success)' : 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26,
            }}>⚠️</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
                  Supply disruption — North Sea corridor
                </h1>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--color-neutral-500)' }}>
                <span>Situation ID: <code style={{
                  background: 'var(--color-neutral-100)',
                  padding: '2px 6px', borderRadius: 4, fontSize: 12,
                }}>{id}</code></span>
                <span>Detected: <strong style={{ color: 'var(--color-neutral-700)' }}>Aug 18, 2026 · 08:12</strong></span>
                <span>Severity: <Badge tone="warning">High</Badge></span>
                <span>Entities affected: <strong style={{ color: 'var(--color-neutral-900)' }}>{entityCount}</strong></span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="md" onClick={() => navigate(-1)}>← Back</Button>
            <Button variant="primary" size="md">Share situation</Button>
          </div>
        </CardContent>
      </Card>

      {/* Two columns */}
      <div className="g12">
        <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Timeline */}
          <Card>
            <CardHeader>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Situation evolution timeline</h2>
              <Badge tone="info">Live</Badge>
            </CardHeader>
            <CardContent style={{ padding: 0 }}>
              <AgentTimeline tasks={timelineTasks} style={{ boxShadow: 'none', borderRadius: 0, border: 'none' }} />
            </CardContent>
          </Card>

          {/* Recommendations */}
          <Card>
            <CardHeader>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Related recommendations</h2>
              <Button variant="outline" size="sm" onClick={() => navigate('/decisions/recommend')}>
                Generate more →
              </Button>
            </CardHeader>
            <CardContent>
              <div className="g12">
                {recs.map((r, i) => (
                  <div key={i} style={{ gridColumn: 'span 6' }}>
                    <RecommendationCard {...r} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Key factors */}
          <Card>
            <CardHeader>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Key contributing factors</h2>
              <Badge tone="primary">{factors.length} signals</Badge>
            </CardHeader>
            <CardContent>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {factors.map((f, i) => (
                  <Tag key={f + i} tone={i % 3 === 0 ? 'primary' : 'neutral'}>
                    {f}
                  </Tag>
                ))}
              </div>
              <div style={{
                marginTop: 'var(--space-3)', padding: 'var(--space-2)',
                background: 'var(--color-neutral-50)',
                borderRadius: 'var(--radius-md)',
                fontSize: 13, color: 'var(--color-neutral-700)',
                lineHeight: 1.6,
              }}>
                <strong style={{ color: 'var(--color-neutral-900)' }}>Summary.</strong>{' '}
                Situation score stands at 0.82 and is trending upward. Early
                intervention is recommended — every 12h of delay is projected
                to increase downstream impact by ~7%.
              </div>
            </CardContent>
          </Card>

          {/* Affected entities */}
          <Card>
            <CardHeader>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Affected entity clusters</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/graph/entities')}>
                Open browser →
              </Button>
            </CardHeader>
            <CardContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { name: 'Suppliers', count: 6, color: '#8B5CF6' },
                  { name: 'Shipments', count: 11, color: 'var(--color-danger)' },
                  { name: 'Warehouses', count: 4, color: 'var(--color-accent)' },
                  { name: 'Orders at risk', count: 29, color: 'var(--color-warning)' },
                  { name: 'Customer accounts', count: 17, color: 'var(--color-success)' },
                ].map((g) => (
                  <div key={g.name} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-neutral-50)',
                    border: '1px solid var(--color-neutral-200)',
                  }}>
                    <span aria-hidden="true" style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: g.color, flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{g.name}</span>
                    <Badge tone="default">{g.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Export */}
          <Card>
            <CardHeader>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Export & actions</h2>
            </CardHeader>
            <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button variant="outline" size="md">📄 Export as PDF report</Button>
              <Button variant="outline" size="md">📊 Export entities (CSV)</Button>
              <Button variant="primary" size="md" onClick={() => navigate('/decisions/scenario')}>
                🎲 Simulate mitigation scenarios
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
