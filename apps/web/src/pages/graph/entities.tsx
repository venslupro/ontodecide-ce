/**
 * GraphEntitiesPage — entity search + results table with row actions.
 * Advanced toolbar: keyword, type dropdown, property filter,
 * tag filter chips, sort selector. Table has view/edit/delete with
 * ConfirmDialog on delete. Pagination Page 1 of 15.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { entitiesResource } from '@/services/api';
import { useSession } from '@/hooks/useSession';
import { useToast } from '@/components/ui/Toast';
import type { EntityNode, IngestPayload } from '@ontodecide/shared';
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
import Modal from '@/components/ui/Modal';

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
const TYPE_COLORS: Record<string, string> = {
  Organization: 'var(--color-primary)',
  Product: 'var(--color-accent)',
  Customer: 'var(--color-success)',
  Supplier: '#8B5CF6',
  Market: 'var(--color-warning)',
  Order: 'var(--color-danger)',
};

export default function GraphEntitiesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { session } = useSession();
  const tenantId = session?.tenant_id ?? '';

  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('updated_desc');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('Organization');
  const [newTags, setNewTags] = useState('');

  const [entities, setEntities] = useState<EntityNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadEntities = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const res = await entitiesResource.find();
      if (!res.success || !res.data) {
        throw new Error(res.error?.message ?? 'No entity data returned by the server.');
      }
      setEntities(res.data);
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to load entities. Please try again.';
      setLoadError(msg);
      toast.show({ tone: 'danger', title: 'Could not load entities', message: msg });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void loadEntities(); }, [loadEntities]);

  const resetNew = () => {
    setNewName(''); setNewType('Organization'); setNewTags(''); setNewOpen(false);
  };
  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    if (!tenantId) {
      toast.show({ tone: 'danger', title: 'Create failed', message: 'Session tenant is not available. Please re-login.' });
      return;
    }
    setSubmitting(true);
    try {
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
      const entity: EntityNode = {
        id: `ent_${crypto.randomUUID()}`,
        tenant_id: tenantId,
        type: newType,
        attributes: { name, tags },
        source: 'web-ui',
        confidence: 1,
        timestamp: new Date().toISOString(),
      };
      const payload: IngestPayload = {
        tenant_id: tenantId,
        entities: [entity],
        relations: [],
        source: 'web-ui',
      };
      const res = await entitiesResource.upsert(payload);
      if (!res.success) {
        throw new Error(res.error?.message ?? 'Could not create the entity.');
      }
      toast.show({ tone: 'success', message: `Entity "${name}" created.` });
      resetNew();
      await loadEntities(true);
    } catch (e: any) {
      toast.show({ tone: 'danger', title: 'Create failed', message: e?.message ?? 'An unexpected error occurred.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await entitiesResource.remove(target.id);
      if (!res.success) {
        throw new Error(res.error?.message ?? 'Could not delete the entity.');
      }
      toast.show({ tone: 'success', message: `Entity "${target.name}" deleted.` });
      await loadEntities(true);
    } catch (e: any) {
      toast.show({ tone: 'danger', title: 'Delete failed', message: e?.message ?? 'An unexpected error occurred.' });
    }
  }, [deleteTarget, loadEntities, toast]);

  const toggleTag = (t: string) => setActiveTags((arr) =>
    arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t],
  );

  // Map backend EntityNode[] into the row view model used by the table.
  const allRows = useMemo(() => entities.map((e) => {
    const attrs = (e.attributes ?? {}) as Record<string, unknown>;
    const name = typeof attrs.name === 'string' && attrs.name.length > 0 ? attrs.name : e.id;
    const tags = Array.isArray(attrs.tags)
      ? attrs.tags.filter((t): t is string => typeof t === 'string')
      : [];
    const parsed = new Date(e.timestamp);
    const updatedDate = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
    return {
      id: e.id,
      name,
      type: e.type,
      tags,
      updated: updatedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      updatedDate,
    };
  }), [entities]);

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
        <Button variant="primary" onClick={() => setNewOpen(true)}>+ New entity</Button>
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
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" style={{ padding: 40, color: 'var(--color-neutral-500)' }}>
                    Loading entities…
                  </TableCell>
                </TableRow>
              ) : loadError ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" style={{ padding: 40, color: 'var(--color-danger)' }}>
                    {loadError}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" style={{ padding: 40, color: 'var(--color-neutral-500)' }}>
                    {allRows.length === 0
                      ? 'No entities yet — click “+ New entity” to create the first one.'
                      : 'No entities match the current filters.'}
                  </TableCell>
                </TableRow>
              ) : rows.map((r) => (
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
                      <IconButton variant="ghost" size="sm" aria-label="View" title="View" onClick={() => navigate(`/graph/situation/${encodeURIComponent(r.id)}`)}>👁</IconButton>
                      <IconButton variant="ghost" size="sm" aria-label="Edit" title="Edit" onClick={() => navigate(`/graph/situation/${encodeURIComponent(r.id)}`)}>✏️</IconButton>
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
        onConfirm={handleDelete}
      >
        <p>
          Are you sure you want to permanently delete <strong>{deleteTarget?.name}</strong>?
          This action cannot be undone and will also remove relationships connected to this entity.
        </p>
      </ConfirmDialog>

      <Modal
        open={newOpen}
        title="Create new entity"
        onClose={resetNew}
        footer={
          <>
            <Button variant="outline" onClick={resetNew} disabled={submitting}>Cancel</Button>
            <Button variant="primary" onClick={submitNew} disabled={!newName.trim() || submitting}>
              {submitting ? 'Creating…' : 'Create entity'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div>
            <label style={fieldLbl}>Name</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Acme Corp"
              autoFocus
            />
          </div>
          <div>
            <label style={fieldLbl}>Entity type</label>
            <Select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              options={TYPE_OPTS.filter((o) => o.value !== 'all')}
            />
          </div>
          <div>
            <label style={fieldLbl}>Tags (comma-separated, optional)</label>
            <Input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="enterprise, vip, eu"
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
