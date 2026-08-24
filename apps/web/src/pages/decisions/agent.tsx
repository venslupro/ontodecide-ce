/**
 * DecisionAgentPage — AI agent chat interface.
 * Left: current task + AgentTimeline of executed steps.
 * Right: messages (user right-aligned purple, AI left-aligned grey) +
 * bottom input with send button. Toolbar: New Chat / History / Export.
 * Includes a 3-4 round conversation with a code-block answer.
 */
import { useState, FormEvent, useEffect, useRef } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Tag from '@/components/ui/Tag';
import AgentTimeline, { AgentTask } from '@/components/shared/AgentTimeline';
import IconButton from '@/components/ui/IconButton';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  code?: { lang: string; body: string };
  timestamp: string;
}

const INITIAL_TASKS: AgentTask[] = [
  { label: 'Parse request', status: 'success', start: '00:00', end: '00:01', result: 'Extracted goal: margin preservation; scope: NA Q4.' },
  { label: 'Fetch market context', status: 'success', start: '00:01', end: '00:03', result: 'Loaded 62 signals across demand, pricing, cost lanes.' },
  { label: 'Graph reasoning (3-hops)', status: 'success', start: '00:03', end: '00:06', result: '1,284 entities evaluated; 18 factors retained.' },
  { label: 'Generate options', status: 'success', start: '00:06', end: '00:08', result: '3 options ranked by confidence.' },
  { label: 'Prepare response', status: 'running', start: '00:08', result: 'Synthesizing final answer with citations…' },
  { label: 'Write to audit log', status: 'pending' },
];

const INITIAL_MESSAGES: Message[] = [
  {
    role: 'user',
    content:
      'I need to protect gross margins through Q4 without giving up too much market share in North America. Where should I start?',
    timestamp: '09:01',
  },
  {
    role: 'assistant',
    content:
      'Great framing. I pulled 62 market signals and ran 3-hop graph reasoning over customers, SKUs and lanes. The dominant levers are pricing on mid-tier SKUs and a 6-week raw-material forward-buy. Here is the current margin decomposition by tier:',
    code: {
      lang: 'json',
      body: `{
  "tier": "mid",
  "sku_count": 184,
  "current_margin_pct": 28.6,
  "target_margin_pct": 31.0,
  "recommended_price_delta_pct": 4.5,
  "projected_volume_loss_pct": 1.8,
  "net_dollar_impact_M": "+3.4"
}`,
    },
    timestamp: '09:01',
  },
  {
    role: 'user',
    content:
      'That looks reasonable. Show me the competitive reaction risk if we move first.',
    timestamp: '09:02',
  },
  {
    role: 'assistant',
    content:
      'Competitive reaction risk is moderate. Three of the top five competitors are hedged less than you are and are unlikely to absorb price rather than follow. You can see the 1-year pattern of matched moves below — follow-through rate is 71% on moves ≥3%. Recommendation: move quickly and pair with a targeted promotional program for the top-50 accounts to lock in retention for 90 days post-change.',
    timestamp: '09:03',
  },
  {
    role: 'user',
    content:
      'Summarize next steps in order with owners and timelines.',
    timestamp: '09:04',
  },
  {
    role: 'assistant',
    content:
      'Here is the sequenced plan. Do you want me to turn this into tasks and assign owners in your PM tool?',
    code: {
      lang: 'markdown',
      body: `1) Elasticity validation — Owner: Pricing Analytics — by EOD Fri
2) Regional GM alignment — Owner: Commercial VP — Mon AM
3) ERP sheet cutover — Owner: RevOps — effective next invoice cycle
4) Top-50 retention promo — Owner: Customer Success — within 5 biz days
5) Weekly dashboard review — Owner: Decision PM — Mondays, 9 weeks`,
    },
    timestamp: '09:04',
  },
];

function nowStr() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function DecisionAgentPage() {
  const [tasks, setTasks] = useState<AgentTask[]>(INITIAL_TASKS);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const userText = input.trim();
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { role: 'user', content: userText, timestamp: nowStr() }]);
    // Simulated agent response
    setTimeout(() => {
      setTasks((t) => t.map((x) => (x.status === 'running' ? { ...x, status: 'success' as const, end: nowStr() } : x)));
      setMessages((m) => [...m, {
        role: 'assistant',
        content:
          'Thanks — I am reasoning through your request. I will cross-check the decision register, apply your guardrails, and reply with a focused answer plus any recommended follow-up questions.',
        timestamp: nowStr(),
      }]);
      setSending(false);
    }, 1100);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Decision agent
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Collaborate with an AI agent that reasons over your knowledge graph
            and walks through every step of a decision.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="outline" size="md">🆕 New chat</Button>
          <Button variant="outline" size="md">📜 History</Button>
          <Button variant="secondary" size="md">⬇ Export</Button>
        </div>
      </div>

      <div className="g12" style={{ alignItems: 'stretch' }}>
        {/* Left panel — task timeline */}
        <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Card>
            <CardHeader>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Current task</h2>
              <Badge tone="primary">Running</Badge>
            </CardHeader>
            <CardContent>
              <div style={{
                padding: 'var(--space-2)',
                background: 'var(--color-primary-50)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid #D4C7FC',
              }}>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-primary)', fontWeight: 700 }}>
                  Session · Q4 2026
                </div>
                <div style={{
                  fontSize: 15, fontWeight: 700, marginTop: 4,
                  color: 'var(--color-neutral-900)', lineHeight: 1.4,
                }}>
                  Preserve gross margin without giving up NA share
                </div>
                <div style={{
                  display: 'flex', gap: 6, flexWrap: 'wrap',
                  marginTop: 8,
                }}>
                  <Tag tone="primary">Margin</Tag>
                  <Tag tone="neutral">NA</Tag>
                  <Tag tone="neutral">Q4</Tag>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Agent step trace</h2>
              <Badge tone="info">Deterministic</Badge>
            </CardHeader>
            <CardContent style={{ padding: 0 }}>
              <AgentTimeline tasks={tasks} style={{ boxShadow: 'none', borderRadius: 0, border: 'none' }} />
            </CardContent>
          </Card>
        </div>

        {/* Right — chat */}
        <Card style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column' }}>
          <CardHeader>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18,
              }}>🤖</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
                  OntoDecide Agent
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-success)' }}>● Online · gpt-decision</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <IconButton variant="ghost" size="sm" aria-label="Speed">⚡</IconButton>
              <IconButton variant="ghost" size="sm" aria-label="Citations">📚</IconButton>
              <IconButton variant="ghost" size="sm" aria-label="Grounding">🪢</IconButton>
            </div>
          </CardHeader>

          <CardContent
            style={{
              padding: 0,
              flex: 1,
              minHeight: 520,
              maxHeight: 640,
            }}
          >
            <div
              ref={scrollRef}
              style={{
                padding: 'var(--space-3)',
                height: '100%',
                overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
                background: 'var(--color-neutral-50)',
              }}
            >
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
              {sending && (
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="agent-avatar" aria-hidden="true" style={avatarAi}>🤖</div>
                <div style={bubbleAi}>
                  <span style={{ letterSpacing: 4, fontWeight: 700 }}>⋯</span>
                </div>
              </div>
            )}
            </div>
          </CardContent>

          <div
            style={{
              padding: 'var(--space-2) var(--space-3) var(--space-3)',
              borderTop: '1px solid var(--color-neutral-200)',
            }}
          >
            <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the agent anything about this decision…"
                leftIcon={<span style={{ color: 'var(--color-neutral-500)' }}>💬</span>}
              />
              <Button type="submit" variant="primary" disabled={!input.trim() || sending}>
                {sending ? '…' : 'Send →'}
              </Button>
            </form>
            <div style={{
              display: 'flex', gap: 6, flexWrap: 'wrap',
              marginTop: 10,
            }}>
              {['Summarize risks', 'Show citations', 'Propose next step', 'Export rationale'].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setInput(p)}
                  style={{
                    fontSize: 12, padding: '4px 10px',
                    borderRadius: 999,
                    background: '#fff',
                    border: '1px solid var(--color-neutral-200)',
                    color: 'var(--color-neutral-600)',
                    cursor: 'pointer',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

const avatarAi: React.CSSProperties = {
  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
  background: 'var(--color-neutral-100)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 16,
};
const avatarUser: React.CSSProperties = {
  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
  background: 'var(--color-primary)',
  color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 14, fontWeight: 700,
};
const bubbleBase: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 14,
  fontSize: 14, lineHeight: 1.6, maxWidth: '85%',
  border: '1px solid var(--color-neutral-200)',
  wordBreak: 'break-word',
};
const bubbleAi: React.CSSProperties = {
  ...bubbleBase,
  background: '#fff',
  color: 'var(--color-neutral-800)',
  borderBottomLeftRadius: 4,
};
const bubbleUser: React.CSSProperties = {
  ...bubbleBase,
  background: 'var(--color-primary)',
  color: '#fff',
  borderColor: 'var(--color-primary)',
  borderBottomRightRadius: 4,
};

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      alignItems: 'flex-start', gap: 8,
    }}>
      {!isUser && <div style={avatarAi} aria-hidden="true">🤖</div>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 4, maxWidth: '85%' }}>
        <div style={isUser ? bubbleUser : bubbleAi}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
          {msg.code && (
            <div style={{
              marginTop: 8,
              background: 'var(--color-neutral-900)',
              color: '#F9FAFB',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{
                padding: '6px 10px', fontSize: 11,
                color: 'var(--color-neutral-300)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                fontWeight: 700,
              }}>
                {msg.code.lang}
              </div>
              <pre style={{
                margin: 0, padding: 10, fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                lineHeight: 1.55, overflowX: 'auto',
              }}>
                <code>{msg.code.body}</code>
              </pre>
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{msg.timestamp}</span>
      </div>
      {isUser && <div style={avatarUser} aria-hidden="true">U</div>}
    </div>
  );
}
