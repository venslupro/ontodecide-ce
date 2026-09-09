/**
 * GraphOntologyPage — ontology schema browser.
 * Tabs: List View (search + category filter + paginated card grid)
 *       Schema View (simple SVG node-edge graph with colored nodes).
 */
import { useState, useMemo } from 'react';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Tabs, { Tab } from '@/components/ui/Tabs';
import Pagination from '@/components/ui/Pagination';
import Badge from '@/components/ui/Badge';
import OntologyTypeCard from '@/components/shared/OntologyTypeCard';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Modal from '@/components/ui/Modal';

const ONTO_COLORS = [
  'var(--color-primary)', 'var(--color-accent)',
  'var(--color-success)', 'var(--color-warning)',
  'var(--color-danger)', '#8B5CF6', '#EC4899', '#14B8A6',
];
const CAT_OPTIONS = [
  { label: 'All categories', value: 'all' },
  { label: 'Business', value: 'biz' },
  { label: 'Market', value: 'mkt' },
  { label: 'People', value: 'ppl' },
  { label: 'Product', value: 'prod' },
  { label: 'Legal', value: 'legal' },
  { label: 'Operations', value: 'ops' },
];
const CATEGORIES = ['biz', 'mkt', 'ppl', 'prod', 'legal', 'ops'];
const BASE_NAMES = [
  'Organization', 'Product', 'Customer', 'Market', 'Supplier', 'Regulation',
  'Contract', 'Employee', 'Order', 'Invoice', 'Warehouse', 'Shipment',
  'Competitor', 'RiskEvent', 'Campaign', 'Asset',
];

export default function GraphOntologyPage() {
  const [tab, setTab] = useState('list');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const size = 8;

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('biz');

  const resetNew = () => {
    setNewName(''); setNewCategory('biz'); setNewOpen(false);
  };
  const submitNew = () => {
    if (!newName.trim()) return;
    resetNew();
  };

  const all = useMemo(() => mockList(
    (i, r) => ({
      name: BASE_NAMES[i % BASE_NAMES.length] + (i >= BASE_NAMES.length ? ` ${Math.floor(i / BASE_NAMES.length) + 1}` : ''),
      id: `ont:${BASE_NAMES[i % BASE_NAMES.length].toLowerCase()}_${i + 1}`,
      propertyCount: 3 + Math.floor(r * 18),
      relationCount: 2 + Math.floor(r * 12),
      color: ONTO_COLORS[i % ONTO_COLORS.length],
      category: CATEGORIES[i % CATEGORIES.length],
    }),
    12, 21,
  ), []);

  const filtered = useMemo(() => all.filter((o) => {
    const matchesQ = !query || o.name.toLowerCase().includes(query.toLowerCase());
    const matchesCat = category === 'all' || o.category === category;
    return matchesQ && matchesCat;
  }), [all, query, category]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / size));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * size, currentPage * size);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Ontology library
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Define your domain schema: entity types, their properties and
            relationships. Browse the list or inspect the graph schema view.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>+ New ontology type</Button>
      </div>

      <Card>
        <CardHeader style={{ paddingBottom: 0, borderBottom: 'none' }}>
          <Tabs value={tab} onChange={setTab}>
            <Tab value="list" label="List View">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {/* Toolbar */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 260px', minWidth: 200 }}>
                    <Input
                      placeholder="Search ontology types…"
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                      leftIcon={<span style={{ color: 'var(--color-neutral-500)' }}>🔍</span>}
                    />
                  </div>
                  <div style={{ width: 220 }}>
                    <Select
                      value={category}
                      onChange={(e) => { setCategory(e.target.value); setPage(1); }}
                      options={CAT_OPTIONS}
                    />
                  </div>
                  <Badge tone="info">{filtered.length} of {all.length} types</Badge>
                </div>

                {/* Grid */}
                <div className="g12">
                  {pageItems.map((o, i) => (
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

                <Pagination
                  page={currentPage}
                  size={size}
                  total={filtered.length}
                  onChange={({ page: p }) => setPage(p)}
                />
              </div>
            </Tab>
            <Tab value="schema" label="Schema View">
              <SchemaView />
            </Tab>
          </Tabs>
        </CardHeader>
        <CardContent style={{ padding: 0 }} />
      </Card>

      <Modal
        open={newOpen}
        title="Create new ontology type"
        onClose={resetNew}
        footer={
          <>
            <Button variant="outline" onClick={resetNew}>Cancel</Button>
            <Button variant="primary" onClick={submitNew} disabled={!newName.trim()}>
              Create type
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div>
            <label style={fieldLbl}>Type name</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Vendor"
              autoFocus
            />
          </div>
          <div>
            <label style={fieldLbl}>Category</label>
            <Select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              options={CAT_OPTIONS.filter((o) => o.value !== 'all')}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

const fieldLbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--color-neutral-700)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};

/** SVG node-edge schema diagram (illustrative). */
function SchemaView() {
  const nodes = [
    { id: 'n1', label: 'Organization', cx: 100, cy: 80, color: 'var(--color-primary)' },
    { id: 'n2', label: 'Product', cx: 320, cy: 60, color: 'var(--color-accent)' },
    { id: 'n3', label: 'Customer', cx: 540, cy: 80, color: 'var(--color-success)' },
    { id: 'n4', label: 'Market', cx: 180, cy: 230, color: 'var(--color-warning)' },
    { id: 'n5', label: 'Supplier', cx: 420, cy: 240, color: '#8B5CF6' },
    { id: 'n6', label: 'Order', cx: 620, cy: 230, color: 'var(--color-danger)' },
    { id: 'n7', label: 'Regulation', cx: 320, cy: 380, color: '#14B8A6' },
  ];
  const edges = [
    { from: 'n1', to: 'n2', label: 'owns' },
    { from: 'n1', to: 'n4', label: 'operates_in' },
    { from: 'n2', to: 'n3', label: 'sold_to' },
    { from: 'n3', to: 'n6', label: 'places' },
    { from: 'n5', to: 'n2', label: 'supplies' },
    { from: 'n7', to: 'n4', label: 'applies_to' },
    { from: 'n1', to: 'n5', label: 'contracts_with' },
  ];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return (
    <div style={{
      width: '100%', background: 'var(--color-neutral-50)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-neutral-200)',
      padding: 'var(--space-3)',
      overflow: 'auto',
    }}>
      <svg width={720} height={460} viewBox="0 0 720 460" style={{ display: 'block', margin: '0 auto' }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-neutral-400)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const f = byId[e.from]; const t = byId[e.to];
          const mx = (f.cx + t.cx) / 2;
          const my = (f.cy + t.cy) / 2;
          return (
            <g key={i}>
              <line
                x1={f.cx} y1={f.cy} x2={t.cx} y2={t.cy}
                stroke="var(--color-neutral-300)" strokeWidth={2}
                markerEnd="url(#arrow)"
              />
              <rect
                x={mx - 34} y={my - 10} width={68} height={20} rx={10}
                fill="#fff" stroke="var(--color-neutral-200)"
              />
              <text x={mx} y={my + 4} textAnchor="middle" fontSize={10} fill="var(--color-neutral-600)" fontWeight={600}>
                {e.label}
              </text>
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.cx - 56} y={n.cy - 18} width={112} height={36} rx={18}
              fill="#fff" stroke={n.color} strokeWidth={2}
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.05))' }}
            />
            <circle cx={n.cx - 40} cy={n.cy} r={8} fill={n.color} opacity={0.25} />
            <circle cx={n.cx - 40} cy={n.cy} r={4} fill={n.color} />
            <text x={n.cx + 6} y={n.cy + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--color-neutral-900)">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
