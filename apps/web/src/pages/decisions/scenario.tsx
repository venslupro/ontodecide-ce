/**
 * DecisionScenarioPage — scenario analysis & comparison.
 * Inputs: topic + description + dynamic variable key/value pairs.
 * Run button with loading → output grid of 3-4 ScenarioCards with
 * varying tones (bullish / bearish / neutral / risky).
 */
import { useState, MouseEvent } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ScenarioCard from '@/components/shared/ScenarioCard';
import IconButton from '@/components/ui/IconButton';

const Spinner = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }} aria-hidden="true">
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M22 12a10 10 0 0 0-10-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

interface Variable { key: string; value: string; }

const MOCK_SCENARIOS = [
  {
    title: 'Bullish — rapid expansion',
    tone: 'bullish' as const,
    narrative:
      'Demand pulls forward two quarters ahead of plan; the supply chain absorbs the load with limited overtime and premium freight. Revenue rises, margins compress modestly on logistics, and cash conversion remains healthy.',
    keyFactors: ['+18% demand lift', 'Capacity headroom 12%', 'Premium freight cap 4%', 'Raw material hedge locked'],
    probability: 38,
  },
  {
    title: 'Base case — steady state',
    tone: 'neutral' as const,
    narrative:
      'Conditions evolve in line with consensus. Pricing actions offset input inflation at the projected rate; service levels hold at 94%. No major disruption and no material change to working capital.',
    keyFactors: ['Inflation 3.2% YoY', 'Service level 94%', 'Pricing pass-through intact', 'FCF yield steady'],
    probability: 46,
  },
  {
    title: 'Bearish — soft landing',
    tone: 'bearish' as const,
    narrative:
      'Consumer demand softens faster than expected; channel inventory builds and promotional activity rises. Gross margins compress ~280 bps, but aggressive cost actions protect operating income to -8% vs plan.',
    keyFactors: ['-9% volume shortfall', 'Promo +4 pts', 'Gross margin -280 bps', 'Cost savings 6%'],
    probability: 62,
  },
  {
    title: 'At risk — supply shock',
    tone: 'risky' as const,
    narrative:
      'A 6-week supplier disruption cascades through EU-West lanes. Customer commitments slip, triggering penalty clauses and forcing emergency re-routing. Market share gives up ~1.2 pts on the quarter.',
    keyFactors: ['6-week disruption', 'Penalties 1.4M', 'Share -1.2 pts', 'Carrier SLA breached'],
    probability: 21,
  },
];

export default function DecisionScenarioPage() {
  const [topic, setTopic] = useState('Q4 North America pricing & capacity');
  const [description, setDescription] = useState(
    'Evaluate pricing strategy and capacity allocation under three demand envelopes, with raw material inflation factored in.',
  );
  const [vars, setVars] = useState<Variable[]>([
    { key: 'Base price index', value: '104' },
    { key: 'Demand delta %', value: '+5' },
    { key: 'Input cost %', value: '+3.2' },
  ]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(true); // start with mock results visible

  const addVar = () => setVars((arr) => [...arr, { key: '', value: '' }]);
  const removeVar = (i: number) => setVars((arr) => arr.filter((_, idx) => idx !== i));
  const updateVar = (i: number, patch: Partial<Variable>) =>
    setVars((arr) => arr.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  const run = (e: MouseEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setRan(true);
    }, 1200);
  };

  const newScenario = () => {
    setTopic('');
    setDescription('');
    setVars([{ key: '', value: '' }]);
    setRan(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Multi-scenario analysis
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Describe a decision context, set variables, and simulate a range of
            plausible futures. Scenarios are ranked by probability and compared side-by-side.
          </p>
        </div>
        <Button variant="primary" onClick={newScenario}>+ New scenario</Button>
      </div>

      {/* Input card */}
      <Card>
        <CardHeader>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Scenario inputs</h2>
          <Badge tone="info">{vars.length} variables</Badge>
        </CardHeader>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="g12">
            <div style={{ gridColumn: 'span 12' }}>
              <label style={lbl}>Topic</label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Q4 capacity allocation"
              />
            </div>
            <div style={{ gridColumn: 'span 12' }}>
              <label style={lbl}>Description & context</label>
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain the decision context, assumptions and goals…"
              />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={lbl}>Decision variables</label>
              <Button variant="secondary" size="sm" onClick={addVar}>+ Add variable</Button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vars.map((v, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                  <Input
                    placeholder="Variable name"
                    value={v.key}
                    onChange={(e) => updateVar(i, { key: e.target.value })}
                  />
                  <Input
                    placeholder="Value"
                    value={v.value}
                    onChange={(e) => updateVar(i, { value: e.target.value })}
                  />
                  <IconButton
                    variant="outline"
                    size="md"
                    aria-label="Remove variable"
                    onClick={() => removeVar(i)}
                  >
                    🗑
                  </IconButton>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="outline">Reset</Button>
            <Button variant="primary" onClick={run} disabled={loading}>
              {loading ? <Spinner /> : '🎲'}
              {loading ? 'Running simulation…' : 'Run scenarios'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {ran && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
              Simulated outcomes
            </h2>
            <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--color-neutral-500)' }}>
              <Badge tone="success">Bullish</Badge>
              <Badge tone="default">Neutral</Badge>
              <Badge tone="danger">Bearish</Badge>
              <Badge tone="warning">At risk</Badge>
            </div>
          </div>
          <div className="g12">
            {MOCK_SCENARIOS.map((s, i) => (
              <div key={s.title} style={{ gridColumn: 'span 6' }}>
                <ScenarioCard {...s} />
                {i === 0 && (
                  <div style={{
                    marginTop: 8, textAlign: 'center',
                    fontSize: 11, color: 'var(--color-neutral-500)',
                  }}>
                    ⭑ Most likely scenario by probability-weighted score.
                  </div>
                )}
              </div>
            ))}
          </div>
          <Card>
            <CardContent style={{
              display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
            }}>
              <Button variant="outline">⬇ Export scenarios (JSON)</Button>
              <Button variant="outline">💬 Ask agent about results</Button>
              <Button variant="primary">✓ Choose scenario</Button>
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
