/**
 * GraphEntitiesPage — entity search + results table with row actions.
 * Advanced toolbar: keyword, type dropdown, property filter,
 * tag filter chips, sort selector. Table has view/edit/delete with
 * ConfirmDialog on delete. Pagination Page 1 of 15.
 */
import { useState, useMemo } from 'react';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Tag from '@/components/ui/Tag';
import Badge from '@/components/ui/Badge';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import IconButton from '@/components/ui/IconButton';
import { Card, CardContent } from '@/components/ui/Card';

const TYPE_OPTS = [
  { label: 'All types', value: 'all' },
  { label: 'Organization', value: 'Organization' },
  { label: 'Product', value: 'Product' },
  { label: 'Customer', value: 'Customer' },
  { label: 'Supplier', value: 'Supplier' },
  { label: 'Market', value: 'Market' },
  { label: 'Order', value: 'Order' },
];
const SORT_OPTS = [
  { label: 'Updated: newest', value: 'updated_desc' },
  { label: 'Updated: oldest', value: 'updated_asc' },
  { label: 'Name: A→Z', value: 'name_asc' },
  { label: 'Name: Z→A', value: 'name_desc' },
];
const TAG_POOL = ['enterprise', 'smb', 'strategic', 'high-risk', 'regulated', 'vip', 'eu', 'us', 'tier-1', 'tier-2'];
const ENTITY_TYPES = ['Organization', 'Product', 'Customer', 'Supplier', 'Market', 'Order'];
const ENTITY_NAMES = [
  'Acme Corp', 'GizmoPro X1', 'Jenna Walsh', 'SupplyChain Inc', 'EU-West', 'Order-4921',
  'Globex', 'NanoBlade 3000', 'Raj Patel', 'PrimeSource LLC', 'APAC-SG', 'Order-4935',
  'Initech', 'HelioX Pod', 'Maria Santos', 'BlueFox Logistics', 'NAM-Central', 'Order-4958',
  'Umbrella Co', 'QuantumV2', 'Tom Becker', 'Evergreen Goods', 'LATAM-BR', 'Order-4977',
];
const TYPE_COLORS: Record<string, string> = {
  Organization: 'var(--color-primary)',
  Product: 'var(--color-accent)',
  Customer: 'var(--color-success)',
  Supplier: '#8B5CF6',
  Market: 'var(--color-warning)',
  Order: 'var(--color-danger)',
};

export default function GraphEntitiesPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('updated_desc');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const toggleTag = (t: string) => setActiveTags((arr) =>
    arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t],
  );

  // Generate the full dataset once (150 rows matching `total`).
  const allRows = useMemo(() => mockList(
    (i, r) => {
      const entType = ENTITY_TYPES[i % ENTITY_TYPES.length];
      const name = ENTITY_NAMES[i % ENTITY_NAMES.length] + (i >= ENTITY_NAMES.length ? ` ${Math.floor(i / ENTITY_NAMES.length) + 1}` : '');
      const tagCount = 1 + Math.floor(r * 3);
      const tags: string[] = [];
      let seed = Math.floor(r * 1000);
      while (tags.length < tagCount) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const t = TAG_POOL[seed % TAG_POOL.length];
        if (!tags.includes(t)) tags.push(t);
      }
      const daysAgo = Math.floor(r * 60);
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return {
        id: `ENT-${String(10000 + i)}`,
        name,
        type: entType,
        tags,
        updated: d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        updatedDate: d,
      };
    },
    150, 33,
  ), []);

  // Apply filters + sorting.
  const filteredRows = useMemo(() => {
    let result = allRows.filter((row) => {
      const q = query.trim().toLowerCase();
      const matchesQ = !q || row.name.toLowerCase().includes(q) || row.id.toLowerCase().includes(q);
      const matchesType = type === 'all' || row.type === type;
      const matchesTags = activeTags.length === 0 || activeTags.every((t) => row.tags.includes(t));
      return matchesQ && matchesType && matchesTags;
    });
    result = [...result];
    switch (sort) {
      case 'updated_desc':
        result.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
        break;
      case 'updated_asc':
        result.sort((a, b) => a.updatedDate.getTime() - b.updatedDate.getTime());
        break;
      case 'name_asc':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        result.sort((a, b) => b.name.localeCompare(a.name));
        break;
    }
    return result;
  }, [allRows, query, type, activeTags, sort]);

  const filteredTotal = filteredRows.length;
  const rows = useMemo(() => {
    const start = (page - 1) * size;
    return filteredRows.slice(start, start + size);
  }, [filteredRows, page, size]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            Entity browser
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Search, filter and manage graph entities. Combine type, tag and
            keyword filters for precise lookups.
          </p>
        </div>
        <Button variant="primary">+ New entity</Button>
      </div>

      <Card>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* Advanced search toolbar */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Input
              placeholder="Search by name or ID…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              leftIcon={<span style={{ color: 'var(--color-neutral-500)' }}>🔍</span>}
            />
            <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} options={TYPE_OPTS} />
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              options={SORT_OPTS}
            />
            <Button variant="outline">🔧 Property filter</Button>
          </div>

          {/* Tag chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-neutral-600)', marginRight: 4 }}>
              Tag filter:
            </span>
            {TAG_POOL.slice(0, 8).map((t) => {
              const active = activeTags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  style={{
                    padding: '4px 10px', borderRadius: 999,
                    fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-neutral-200)'}`,
                    background: active ? 'var(--color-primary-50)' : '#fff',
                    color: active ? 'var(--color-primary)' : 'var(--color-neutral-700)',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {t}
                </button>
              );
            })}
            {activeTags.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTags([])}
                style={{
                  fontSize: 12, color: 'var(--color-neutral-500)',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '0 8px',
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone="info">{filteredTotal} total entities</Badge>
            {type !== 'all' && <Tag tone="primary" onClose={() => setType('all')}>Type: {type}</Tag>}
            {activeTags.map((t) => <Tag key={t} tone="primary" onClose={() => toggleTag(t)}>{t}</Tag>)}
            {query && <Tag tone="primary" onClose={() => setQuery('')}>“{query}”</Tag>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent style={{ padding: 0 }}>
          <Table style={{ border: 'none', borderRadius: 0 }}>
            <TableHeader>
              <TableCell header>Entity ID</TableCell>
              <TableCell header>Name</TableCell>
              <TableCell header>Type</TableCell>
              <TableCell header>Tags</TableCell>
              <TableCell header>Updated</TableCell>
              <TableCell header align="right">Actions</TableCell>
            </TableHeader>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <code style={{
                      fontSize: 12, color: 'var(--color-neutral-600)',
                      background: 'var(--color-neutral-100)', padding: '2px 6px',
                      borderRadius: 4,
                    }}>{r.id}</code>
                  </TableCell>
                  <TableCell style={{ fontWeight: 600, color: 'var(--color-neutral-900)' }}>
                    {r.name}
                  </TableCell>
                  <TableCell>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 13,
                    }}>
                      <span aria-hidden="true" style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: TYPE_COLORS[r.type] ?? 'var(--color-neutral-400)',
                      }} />
                      {r.type}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {r.tags.map((t) => <Tag key={t} tone="neutral">{t}</Tag>)}
                    </div>
                  </TableCell>
                  <TableCell>{r.updated}</TableCell>
                  <TableCell align="right">
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <IconButton variant="ghost" size="sm" aria-label="View" title="View">👁</IconButton>
                      <IconButton variant="ghost" size="sm" aria-label="Edit" title="Edit">✏️</IconButton>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label="Delete"
                        title="Delete"
                        onClick={() => setDeleteTarget({ id: r.id, name: r.name })}
                        style={{ color: 'var(--color-danger)' }}
                      >
                        🗑
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          <div style={{ padding: '0 var(--space-3)' }}>
            <Pagination
              page={page}
              size={size}
              total={filteredTotal}
              onChange={({ page: p, size: s }) => { setPage(p); setSize(s); }}
            />
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete entity ${deleteTarget?.id ?? ''}`}
        confirmTone="danger"
        confirmLabel="Delete entity"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => setDeleteTarget(null)}
      >
        <p>
          Are you sure you want to permanently delete <strong>{deleteTarget?.name}</strong>?
          This action cannot be undone and will also remove relationships connected to this entity.
        </p>
      </ConfirmDialog>
    </div>
  );
}
