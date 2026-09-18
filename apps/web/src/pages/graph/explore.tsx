/**
 * GraphExplorePage — graph exploration rooted at a single entity.
 * Calls POST /api/graph/explore and renders the returned SituationNode[]
 * as an SVG network. Left panel: root entity id + depth. Center: canvas.
 * Right: selected node details + relations.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { graphResource } from '@/services/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Tag from '@/components/ui/Tag';
import Badge from '@/components/ui/Badge';
import IconButton from '@/components/ui/IconButton';
import type { SituationNode } from '@ontodecide/shared';

const TYPE_COLORS: Record<string, string> = {
  Organization: 'var(--color-primary)',
  Product: 'var(--color-accent)',
  Customer: 'var(--color-success)',
  Supplier: '#8B5CF6',
  Market: 'var(--color-warning)',
  Order: 'var(--color-danger)',
};

interface GraphNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
}
interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

/** Convert SituationNode[] into a flat node/edge set with a radial layout. */
function buildGraph(nodes: SituationNode[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // Root is the first node's entity.
  const root = nodes[0]?.entity;
  if (!root) return { nodes: [], edges: [] };

  nodeMap.set(root.id, { id: root.id, label: root.id, type: root.type, x: 420, y: 300 });

  // Collect all related entities and position them radially.
  const related: Array<{ id: string; type: string }> = [];
  const seen = new Set<string>([root.id]);
  for (const sn of nodes) {
    for (const rel of sn.relations) {
      if (!seen.has(rel.target.id)) {
        seen.add(rel.target.id);
        related.push({ id: rel.target.id, type: rel.target.type });
      }
      edges.push({ from: sn.entity.id, to: rel.target.id, label: rel.type });
    }
  }

  related.forEach((r, i) => {
    const angle = (i / Math.max(related.length, 1)) * Math.PI * 2;
    const radius = 180;
    nodeMap.set(r.id, {
      id: r.id,
      label: r.id,
      type: r.type,
      x: 420 + Math.cos(angle) * radius,
      y: 300 + Math.sin(angle) * radius,
    });
  });

  return { nodes: Array.from(nodeMap.values()), edges };
}

export default function GraphExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [entityId, setEntityId] = useState(searchParams.get('id') ?? '');
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SituationNode[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const graph = useMemo(() => buildGraph(results), [results]);
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const selected = byId[selectedId];

  const selectedRelations = useMemo(() => {
    const found = results.find((r) => r.entity.id === selectedId);
    return found?.relations ?? [];
  }, [results, selectedId]);

  const handleExplore = useCallback(async () => {
    if (!entityId.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setSearchParams({ id: entityId });
    try {
      const res = await graphResource.explore({ entityId: entityId.trim(), depth });
      if (!res.success) {
        setError(res.error?.message ?? 'Exploration failed.');
      } else {
        setResults(res.data ?? []);
        const first = res.data?.[0]?.entity.id;
        if (first) setSelectedId(first);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [entityId, depth, setSearchParams]);

  // Auto-explore when an id is present in the URL.
  useEffect(() => {
    const id = searchParams.get('id');
    if (id && id !== entityId) {
      setEntityId(id);
    }
  }, [searchParams, entityId]);

  // Trigger exploration when the entity id changes (e.g. from URL param).
  const lastExploredRef = useRef('');
  useEffect(() => {
    if (entityId && entityId !== lastExploredRef.current) {
      lastExploredRef.current = entityId;
      void handleExplore();
    }
  }, [entityId, handleExplore]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Graph explorer
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Navigate nodes, traverse relationships, inspect properties.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <IconButton variant="outline" size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(z + 0.15, 2))}>➕</IconButton>
          <IconButton variant="outline" size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(z - 0.15, 0.5))}>➖</IconButton>
          <IconButton variant="outline" size="sm" aria-label="Reset view" onClick={() => setZoom(1)}>⟲</IconButton>
        </div>
      </div>

      <div className="g12" style={{ alignItems: 'stretch' }}>
        {/* Left controls */}
        <Card style={{ gridColumn: 'span 3' }}>
          <CardHeader>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Explore controls</h3>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div>
              <label style={lbl}>Root entity ID</label>
              <Input
                placeholder="e.g. entity-123"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label style={lbl}>Expansion depth</label>
                <strong style={{ fontSize: 13 }}>{depth} hops</strong>
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>
            <Button variant="primary" onClick={handleExplore} disabled={loading}>
              {loading ? 'Exploring…' : '🌱 Explore'}
            </Button>

            {error && (
              <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4 }}>{error}</div>
            )}

            <div style={{ borderTop: '1px solid var(--color-neutral-200)', paddingTop: 'var(--space-2)' }}>
              <div style={lbl}>Legend</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(TYPE_COLORS).map(([t, c]) => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
                    <span style={{ color: 'var(--color-neutral-700)' }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Center canvas */}
        <Card style={{ gridColumn: 'span 6' }}>
          <CardContent
            style={{
              padding: 'var(--space-2)',
              background: 'radial-gradient(circle at 50% 50%, #fff 0%, var(--color-neutral-50) 100%)',
              minHeight: 620,
              overflow: 'hidden',
            }}
          >
            {graph.nodes.length === 0 && (
              <div style={{
                height: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-neutral-400)', fontSize: 14,
              }}>
                Enter a root entity ID and click Explore.
              </div>
            )}
            {graph.nodes.length > 0 && (
              <div style={{
                width: '100%', height: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'transform .2s ease',
                transform: `scale(${zoom})`,
              }}>
                <svg width={840} height={600} viewBox="0 0 840 600">
                  <defs>
                    <marker id="arrow-explore" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill="var(--color-neutral-400)" />
                    </marker>
                  </defs>
                  {graph.edges.map((e, i) => {
                    const f = byId[e.from]; const t = byId[e.to];
                    if (!f || !t) return null;
                    const highlighted = e.from === selectedId || e.to === selectedId;
                    const faded = hoverId && e.from !== hoverId && e.to !== hoverId;
                    const mx = (f.x + t.x) / 2;
                    const my = (f.y + t.y) / 2;
                    return (
                      <g key={i} style={{ opacity: faded ? 0.2 : 1 }}>
                        <line
                          x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                          stroke={highlighted ? 'var(--color-primary)' : 'var(--color-neutral-300)'}
                          strokeWidth={highlighted ? 2.5 : 1.5}
                          markerEnd="url(#arrow-explore)"
                        />
                        <rect x={mx - 30} y={my - 9} width={60} height={18} rx={9} fill="#fff" stroke="var(--color-neutral-200)" />
                        <text x={mx} y={my + 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--color-neutral-600)">
                          {e.label}
                        </text>
                      </g>
                    );
                  })}
                  {graph.nodes.map((n) => {
                    const isSel = n.id === selectedId;
                    const isHov = n.id === hoverId;
                    const c = TYPE_COLORS[n.type] ?? 'var(--color-neutral-400)';
                    return (
                      <g
                        key={n.id}
                        onClick={() => setSelectedId(n.id)}
                        onMouseEnter={() => setHoverId(n.id)}
                        onMouseLeave={() => setHoverId(null)}
                        style={{ cursor: 'pointer' }}
                      >
                        {isSel && <circle cx={n.x} cy={n.y} r={32} fill="none" stroke={c} strokeWidth={2} opacity={0.35} />}
                        <rect
                          x={n.x - 52} y={n.y - 16} width={104} height={32} rx={16}
                          fill={isSel || isHov ? c : '#fff'}
                          stroke={c}
                          strokeWidth={isSel ? 2.5 : 1.5}
                          style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.06))', transition: 'all .15s ease' }}
                        />
                        <circle cx={n.x - 40} cy={n.y} r={5} fill={isSel || isHov ? '#fff' : c} />
                        <text
                          x={n.x + 6} y={n.y + 4}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight={700}
                          fill={isSel || isHov ? '#fff' : 'var(--color-neutral-900)'}
                        >
                          {n.label.length > 12 ? n.label.slice(0, 11) + '…' : n.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right details */}
        <Card style={{ gridColumn: 'span 3' }}>
          <CardHeader>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Node details</h3>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {!selected && (
              <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
                Select a node to view details.
              </div>
            )}
            {selected && (
              <>
                <div style={{
                  padding: 'var(--space-2)',
                  background: 'var(--color-neutral-50)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-neutral-200)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span aria-hidden="true" style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: TYPE_COLORS[selected.type] ?? 'var(--color-neutral-400)',
                    }} />
                    <Tag tone="primary">{selected.type}</Tag>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>{selected.label}</div>
                </div>

                <div>
                  <div style={lbl}>Relations ({selectedRelations.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedRelations.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setSelectedId(r.target.id);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-neutral-200)',
                          background: '#fff', cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: 'var(--color-primary)',
                          background: 'var(--color-primary-50)',
                          padding: '1px 6px', borderRadius: 4,
                        }}>→ {r.type}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
                          {r.target.id}
                        </span>
                        <Badge tone="default">{r.target.type}</Badge>
                      </button>
                    ))}
                    {selectedRelations.length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>No relations.</span>
                    )}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/graph/situation/${encodeURIComponent(selected.id)}`)}
                >
                  View full situation →
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--color-neutral-700)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
