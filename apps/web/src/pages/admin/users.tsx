/**
 * AdminUsersPage — admin-only user directory.
 * Search + filters + Invite button, table (user avatar, email, role via RoleBadge,
 * state via UserStateBadge, last login, actions), pagination (Page 1 of 5),
 * batch action bar when rows selected.
 */
import { useState, useMemo } from 'react';
import { mockList } from '@/lib/mock';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Checkbox from '@/components/ui/Checkbox';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import RoleBadge from '@/components/shared/RoleBadge';
import UserStateBadge from '@/components/shared/UserStateBadge';
import IconButton from '@/components/ui/IconButton';

type UserRole = 'admin' | 'analyst' | 'viewer';
type UserState = 'active' | 'pending' | 'disabled' | 'data_cleared';

const ROLE_OPTIONS = [
  { label: 'All roles', value: 'all' },
  { label: 'Admin', value: 'admin' },
  { label: 'Analyst', value: 'analyst' },
  { label: 'Viewer', value: 'viewer' },
];
const STATE_OPTIONS = [
  { label: 'All states', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Pending', value: 'pending' },
  { label: 'Disabled', value: 'disabled' },
  { label: 'Data Cleared', value: 'data_cleared' },
];

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  state: UserState;
  lastLogin: string;
  avatarColor: string;
}

const AVATAR_COLORS = [
  'var(--color-primary)', 'var(--color-accent)', 'var(--color-success)',
  'var(--color-warning)', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];
const NAMES = [
  'Alex Chen', 'Priya Sharma', 'Marcus Bauer', 'Fatima Al-Farsi',
  'Jordan Kim', 'Sophie Laurent', 'Diego Ramirez', 'Lin Wei',
  'Nora Okonkwo', 'Tom Becker', 'Ingrid Hansen', 'Raj Patel',
  'Ana Santos', 'William Foster', 'Yuki Tanaka', 'Ida Svensson',
];

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const total = 48;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: 'disable' | 'enable' | 'delete'; targetIds: string[] } | null>(null);

  const allRows: UserRow[] = useMemo(() => mockList(
    (i, r) => {
      const roles: UserRole[] = ['admin', 'analyst', 'analyst', 'viewer', 'viewer', 'viewer'];
      const states: UserState[] = ['active', 'active', 'active', 'pending', 'disabled', 'data_cleared'];
      const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');
      const email = `${name.split(' ')[0].toLowerCase()}.${name.split(' ').slice(-1)[0].toLowerCase()}@acme.ai`;
      const days = Math.floor(r * 90);
      const last = days === 0 ? 'just now' : `${days}d ago`;
      return {
        id: `U-${String(50000 + i)}`,
        name,
        email,
        role: roles[i % roles.length],
        state: states[i % states.length],
        lastLogin: last,
        avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
      };
    }, 48, 202,
  ), []);

  const pageRows = useMemo(() => {
    const start = (page - 1) * size;
    return allRows.slice(start, start + size);
  }, [allRows, page, size]);

  const filteredRows = useMemo(() => allRows.filter((u) => {
    const q = query.trim().toLowerCase();
    const matchesQ = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesR = roleFilter === 'all' || u.role === roleFilter;
    const matchesS = stateFilter === 'all' || u.state === stateFilter;
    return matchesQ && matchesR && matchesS;
  }), [allRows, query, roleFilter, stateFilter]);

  const allChecked = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const someChecked = pageRows.some((r) => selected.has(r.id));

  const toggleRow = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((s) => {
    const next = new Set(s);
    if (allChecked) pageRows.forEach((r) => next.delete(r.id));
    else pageRows.forEach((r) => next.add(r.id));
    return next;
  });

  const batchAction = (kind: 'disable' | 'enable' | 'delete') => () => {
    if (selected.size === 0) return;
    setConfirm({ kind, targetIds: Array.from(selected) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            User management
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Invite, enable, disable and remove workspace members. Assign roles
            and review last-seen timestamps.
          </p>
        </div>
        <Button variant="primary">+ Invite user</Button>
      </div>

      <Card>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 'var(--space-2)' }}>
            <Input
              placeholder="Search users by name or email…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              leftIcon={<span style={{ color: 'var(--color-neutral-500)' }}>🔍</span>}
            />
            <Select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} options={ROLE_OPTIONS} />
            <Select value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setPage(1); }} options={STATE_OPTIONS} />
            <Badge tone="info">{filteredRows.length} users</Badge>
          </div>
          {selected.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px',
              background: 'var(--color-primary-50)',
              border: '1px solid #D4C7FC',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                {selected.size} user{selected.size === 1 ? '' : 's'} selected
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="outline" onClick={batchAction('enable')}>✓ Enable</Button>
                <Button size="sm" variant="outline" onClick={batchAction('disable')}>⛔ Disable</Button>
                <Button size="sm" variant="danger" onClick={batchAction('delete')}>🗑 Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent style={{ padding: 0 }}>
          <Table style={{ border: 'none', borderRadius: 0 }}>
            <TableHeader>
              <TableCell header style={{ width: 44 }}>
                <Checkbox
                  id="sel-all"
                  name="sel-all"
                  checked={allChecked}
                  ref={undefined as any}
                  onChange={toggleAll}
                  aria-label="Select all rows"
                  {...({ indeterminate: !allChecked && someChecked } as any)}
                />
              </TableCell>
              <TableCell header>User</TableCell>
              <TableCell header>Email</TableCell>
              <TableCell header>Role</TableCell>
              <TableCell header>Status</TableCell>
              <TableCell header>Last login</TableCell>
              <TableCell header align="right">Actions</TableCell>
            </TableHeader>
            <tbody>
              {pageRows.map((u) => {
                const initials = u.name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Checkbox
                        id={`sel-${u.id}`}
                        name={u.id}
                        checked={selected.has(u.id)}
                        onChange={() => toggleRow(u.id)}
                        aria-label={`Select ${u.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div aria-hidden="true" style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: u.avatarColor, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 12, flexShrink: 0,
                        }}>
                          {initials}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-neutral-900)', fontSize: 14 }}>
                            {u.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                            {u.id}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <a href={`mailto:${u.email}`} style={{ color: 'var(--color-accent)', fontSize: 13 }}>
                        {u.email}
                      </a>
                    </TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell><UserStateBadge state={u.state} /></TableCell>
                    <TableCell style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
                      {u.lastLogin}
                    </TableCell>
                    <TableCell align="right">
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <IconButton variant="ghost" size="sm" aria-label="Edit user">✏️</IconButton>
                        <IconButton variant="ghost" size="sm" aria-label="Reset password">🔑</IconButton>
                        <IconButton variant="ghost" size="sm" aria-label="Disable">⛔</IconButton>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="Delete"
                          onClick={() => setConfirm({ kind: 'delete', targetIds: [u.id] })}
                          style={{ color: 'var(--color-danger)' }}
                        >🗑</IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
          <div style={{ padding: '0 var(--space-3)' }}>
            <Pagination
              page={page}
              size={size}
              total={total}
              onChange={({ page: p, size: s }) => { setPage(p); setSize(s); }}
            />
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === 'delete' ? 'Delete selected users?' :
          confirm?.kind === 'disable' ? 'Disable selected users?' :
          'Enable selected users?'
        }
        confirmTone={confirm?.kind === 'delete' ? 'danger' : 'primary'}
        confirmLabel={
          confirm?.kind === 'delete' ? 'Delete' :
          confirm?.kind === 'disable' ? 'Disable' : 'Enable'
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const ids = confirm?.targetIds ?? [];
          setSelected((s) => {
            const n = new Set(s);
            ids.forEach((id) => n.delete(id));
            return n;
          });
          setConfirm(null);
        }}
      >
        <p>
          This action applies to <strong>{confirm?.targetIds.length ?? 0}</strong> selected
          user{confirm?.targetIds.length === 1 ? '' : 's'}.
        </p>
      </ConfirmDialog>
    </div>
  );
}
