/**
 * GraphExplorePage — three-pane graph exploration.
 * Left: search, type filter, depth slider, expand button.
 * Center: large SVG network canvas with colored nodes, edge labels, hover.
 * Right: selected node detail (properties table, relations list, CTA buttons).
 * Top toolbar: zoom +/-, reset, fullscreen, export PNG.
 */
import { useState, useMemo } from 'react';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Tag from '@/components/ui/Tag';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';
import IconButton from '@/components/ui/IconButton';

const TYPE_OPTS = [
  { label: 'All node types', value: 'all' },
  { label: 'Organization', value: 'Organization' },
  { label: 'Product', value: 'Product' },
  { label: 'Customer', value: 'Customer' },
  { label: 'Supplier', value: 'Supplier' },
  { label: 'Market', value: 'Market' },
];

const TYPE_COLORS: Record<string, string> = {
  Organization: 'var(--color-primary)',
  Product: 'var(--color-accent)',
  Customer: 'var(--color-success)',
  Supplier: '#8B5CF6',
  Market: 'var(--color-warning)',
  Order: 'var(--color-danger)',
};

/** Deterministic network nodes positioned in a radial layout. */
function buildGraph(seed: number) {
  const types = Object.keys(TYPE_COLORS);
  const centers = [
    { x: 420, y: 300, label: 'Acme Corp', type: 'Organization' },
  ];
  const nodes: Array<{ id: string; label: string; type: string; x: number; y: number }> = [];
  nodes.push({ id: 'n0', ...centers[0] });
  let s = seed >>> 0;
  const names = ['GizmoPro X1', 'Jenna Walsh', 'SupplyChain', 'EU-West',
    'Order 4921', 'Globex Partner', 'NanoBlade 3000', 'Raj Patel',
    'PrimeSource', 'APAC-SG', 'HelioX Pod', 'Maria Santos'];
  for (let i = 0; i < 12; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const angle = (i / 12) * Math.PI * 2 + (s / 0xffffffff) * 0.3;
    const radius = 170 + ((s >>> 3) % 40);
    nodes.push({
      id: `n${i + 1}`,
      label: names[i % names.length],
      type: types[(i + 1) % types.length],
      x: centers[0].x + Math.cos(angle) * radius,
      y: centers[0].y + Math.sin(angle) * radius,
    });
  }
  const edges: Array<{ from: string; to: string; label: string }> = [];
  const rels = ['owns', 'employs', 'supplies', 'operates_in', 'placed_by',
    'references', 'partner_of', 'related_to'];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ from: 'n0', to: nodes[i].id, label: rels[i % rels.length] });
    if (i % 3 === 0 && i + 1 < nodes.length) {
      edges.push({ from: nodes[i].id, to: nodes[i + 1].id, label: rels[(i * 7) % rels.length] });
    }
  }
  return { nodes, edges };
}

export default function GraphExplorePage() {
  const [nodeType, setNodeType] = useState('all');
  const [search, setSearch] = useState('');
  const [depth, setDepth] = useState(3);
  const [selectedId, setSelectedId] = useState<string>('n0');
  const [zoom, setZoom] = useState(1);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const graph = useMemo(() => buildGraph(42), []);

  // Apply search and type filters to the visible node set.
  const visibleNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return graph.nodes.filter((n) => {
      const matchesQ = !q || n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
      const matchesType = nodeType === 'all' || n.type === nodeType;
      return matchesQ && matchesType;
    });
  }, [graph.nodes, search, nodeType]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => graph.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)),
    [graph.edges, visibleIds],
  );

  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const selected = byId[selectedId] ?? graph.nodes[0];

  // Derived neighbouring relations for the selected node.
  const neighbors = useMemo(() => {
    const outgoing = graph.edges.filter((e) => e.from === selectedId);
    const incoming = graph.edges.filter((e) => e.to === selectedId);
    return [
      ...outgoing.map((e) => ({ rel: e.label, other: byId[e.to], dir: '→' as const })),
      ...incoming.map((e) => ({ rel: e.label, other: byId[e.from], dir: '←' as const })),
    ];
  }, [selectedId, graph.edges, byId]);

  const props = mockList(
    (i, r) => {
      const keys = ['Legal Name', 'Founded', 'Revenue (M)', 'Employees',
        'HQ Country', 'Industry', 'Website', 'Tax ID'];
      const vals = [
        'ACME Holdings, Inc.', '1998', '$284', '1,240', 'United States',
        'Manufacturing', 'acme.example', 'US-42-8812345',
      ];
      return { key: keys[i % keys.length], value: vals[i % vals.length] + (r > 0.7 ? ` (${Math.floor(r * 10)})` : '') };
    }, 6, 77,
  );

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
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <IconButton variant="outline" size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(z + 0.15, 2))}>➕</IconButton>
          <IconButton variant="outline" size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(z - 0.15, 0.5))}>➖</IconButton>
          <IconButton variant="outline" size="sm" aria-label="Reset view" onClick={() => { setZoom(1); setSelectedId('n0'); }}>⟲</IconButton>
          <IconButton variant="outline" size="sm" aria-label="Fullscreen">⛶</IconButton>
          <Button variant="secondary" size="sm">⬇ Export PNG</Button>
        </div>
      </div>

      <div className="g12" style={{ alignItems: 'stretch' }}>
        {/* Left search panel */}
        <Card style={{ gridColumn: 'span 3' }}>
          <CardHeader>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Explore controls</h3>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div>
              <label style={lbl}>Find nodes</label>
              <Input
                placeholder="Search by name, ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftIcon={<span style={{ color: 'var(--color-neutral-500)', fontSize: 14 }}>🔍</span>}
              />
            </div>
            <div>
              <label style={lbl}>Node type</label>
              <Select value={nodeType} onChange={(e) => setNodeType(e.target.value)} options={TYPE_OPTS} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label style={lbl}>Expansion depth</label>
                <strong style={{ fontSize: 13 }}>{depth} hops</strong>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
            </div>
            <Button variant="primary">🌱 Expand from selection</Button>

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
              cursor: 'grab',
            }}
          >
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
                {/* Edges */}
                {visibleEdges.map((e, i) => {
                  const f = byId[e.from]; const t = byId[e.to];
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
                {/* Nodes */}
                {visibleNodes.map((n) => {
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
          </CardContent>
        </Card>

        {/* Right details */}
        <Card style={{ gridColumn: 'span 3' }}>
          <CardHeader>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Node details</h3>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>ID: {selected.id.toUpperCase()}</div>
            </div>

            <div>
              <div style={lbl}>Properties</div>
              <Table style={{ borderRadius: 'var(--radius-md)' }}>
                <TableHeader>
                  <TableCell header style={{ padding: '8px 12px' }}>Key</TableCell>
                  <TableCell header align="right" style={{ padding: '8px 12px' }}>Value</TableCell>
                </TableHeader>
                <tbody>
                  {props.map((p) => (
                    <TableRow key={p.key}>
                      <TableCell style={{ padding: '8px 12px', fontSize: 12 }}>
                        <span style={{ color: 'var(--color-neutral-600)' }}>{p.key}</span>
                      </TableCell>
                      <TableCell align="right" style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>
                        {p.value}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>

            <div>
              <div style={lbl}>Related nodes ({neighbors.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {neighbors.map((n, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedId(n.other.id)}
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
                    }}>{n.dir} {n.rel}</span>
                    <span aria-hidden="true" style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: TYPE_COLORS[n.other.type],
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
                      {n.other.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="primary" size="sm" style={{ flex: 1 }}>✏ Edit</Button>
              <Button variant="outline" size="sm" style={{ flex: 1 }}>🔗 View relations</Button>
            </div>
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
