/**
 * DecisionRecommendPage — AI recommendation generator.
 * Input: goal text, constraint checkboxes, time-range selector.
 * Generate button → shows 2-3 RecommendationCards with high/medium/low
 * priorities plus an action button bar (Adopt / Reject / Save).
 */
import { useState, FormEvent } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Checkbox from '@/components/ui/Checkbox';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import RecommendationCard from '@/components/shared/RecommendationCard';

const Spinner = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }} aria-hidden="true">
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M22 12a10 10 0 0 0-10-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const CONSTRAINT_OPTS = [
  'Budget cap preserved',
  'No layoffs',
  'Regulatory compliance (GDPR)',
  'Minimize supplier churn',
  'Maintain 90-day liquidity',
  'Carbon-neutral footprint',
];

const TIME_OPTS = [
  { label: 'This quarter (90 days)', value: 'q' },
  { label: 'Next 6 months', value: 'h' },
  { label: 'FY horizon (1 year)', value: 'y' },
  { label: 'Strategic (2-3 years)', value: 's' },
];

const RECOMMENDATIONS = [
  {
    title: 'Reprice mid-tier SKU portfolio +4.5%',
    priority: 'high' as const,
    confidence: 91,
    rationale:
      'Input costs are accelerating beyond carry-over hedges. Elasticity models indicate a +4.5% mid-tier price rise captures ~88% of the delta with <2% volume loss. Timing is critical: action within 3 weeks ahead of competitors.',
    steps: [
      { label: 'Run elasticity by SKU cluster', description: 'Use the Q2 Q-P panel; validate with sales.' },
      { label: 'Notify regional GMs', description: 'Lock commercial alignment before public announcement.' },
      { label: 'Publish new price sheets', description: 'ERP effective date aligns with next invoice cycle.' },
    ],
  },
  {
    title: 'Forward-buy 6 weeks of strategic inputs',
    priority: 'medium' as const,
    confidence: 74,
    rationale:
      'Forward curves for two strategic raw materials are at +11% over 3 months. A 6-week forward-buy locks current pricing and absorbs expected spot-market disruption; downside limited to storage cost (0.8% of value).',
    steps: [
      { label: 'Authorize treasury cash allocation' },
      { label: 'Book storage and logistics slots', description: 'EU-West and APAC-SG warehouses.' },
      { label: 'Reconcile with procurement risk policy', description: 'Update exposure dashboard weekly.' },
    ],
  },
  {
    title: 'Pilot regional freight consolidation',
    priority: 'low' as const,
    confidence: 62,
    rationale:
      'A 4-lane freight consolidation pilot has a bounded downside (<1% of carrier spend) and 22% upside if service levels hold. It can be staged after the pricing move; no urgency.',
    steps: [
      { label: 'Select pilot lanes and carriers' },
      { label: 'Measure baseline service & cost' },
      { label: 'Go / no-go after 8 weeks', description: 'Decision gate tied to KPI thresholds.' },
    ],
  },
];

export default function DecisionRecommendPage() {
  const [goal, setGoal] = useState(
    'Protect gross margins through year-end while holding market share in North America.',
  );
  const [constraints, setConstraints] = useState<string[]>([CONSTRAINT_OPTS[0], CONSTRAINT_OPTS[4]]);
  const [timeRange, setTimeRange] = useState('q');
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const toggleConstraint = (c: string) => setConstraints((arr) =>
    arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c],
  );

  const generate = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setToast(null);
    setTimeout(() => {
      setLoading(false);
      setGenerated(true);
    }, 1400);
  };

  const applyAction = (label: string) => {
    setToast(`${label}: action dispatched for ${RECOMMENDATIONS.length} recommendations.`);
    setTimeout(() => setToast(null), 3200);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Decision recommendations
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Frame a clear goal, apply constraints, and let the AI generate
            prioritized, explainable recommendations with concrete next steps.
          </p>
        </div>
        <Badge tone="primary">AI powered</Badge>
      </div>

      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Decision framing</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={generate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label style={lbl}>Decision goal</label>
              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe the goal in clear, measurable terms…"
                leftIcon={<span style={{ color: 'var(--color-primary)' }}>🎯</span>}
              />
            </div>
            <div>
              <label style={lbl}>Constraints</label>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
                gap: 8, padding: 'var(--space-2)',
                background: 'var(--color-neutral-50)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-neutral-200)',
              }}>
                {CONSTRAINT_OPTS.map((c) => (
                  <Checkbox
                    key={c}
                    name={c}
                    label={c}
                    checked={constraints.includes(c)}
                    onChange={() => toggleConstraint(c)}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', alignItems: 'end' }}>
              <div>
                <label style={lbl}>Time range</label>
                <Select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  options={TIME_OPTS}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button type="button" variant="outline">Clear</Button>
                <Button type="submit" variant="primary" disabled={loading}>
                  {loading ? <Spinner /> : '✨'}
                  {loading ? 'Generating…' : 'Generate recommendations'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {toast && (
        <Alert tone="success" title="Saved" onClose={() => setToast(null)}>{toast}</Alert>
      )}

      {generated && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
              Prioritized recommendations
            </h2>
            <Badge tone="info">{RECOMMENDATIONS.length} options</Badge>
          </div>

          <div className="g12">
            {RECOMMENDATIONS.map((r, i) => (
              <div
                key={i}
                style={{
                  gridColumn: 'span 4',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 8,
                    background: 'var(--color-neutral-100)',
                    color: 'var(--color-neutral-700)',
                    fontWeight: 700,
                    marginBottom: 8,
                    fontSize: 13,
                  }}
                >
                  {i + 1}
                </div>
                <RecommendationCard {...r} />
              </div>
            ))}
          </div>

          <Card>
            <CardContent style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
            }}>
              <Button variant="outline" size="md">💾 Save draft</Button>
              <Button variant="danger" size="md" onClick={() => applyAction('Reject')}>✕ Reject all</Button>
              <Button variant="primary" size="md" onClick={() => applyAction('Adopt')}>
                ✓ Adopt recommendations
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--color-neutral-700)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
