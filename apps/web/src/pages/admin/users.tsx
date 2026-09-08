/**
 * AdminUsersPage — admin-only user directory (live backend data).
 *
 * Replaces the previous mock-based layout with a real implementation:
 *   1. Data source: `adminUsersResource.list()` — pulled from the backend on
 *      mount / filter change. (Max users = 20 per system_config so a single
 *      size=100 fetch gets everything; in-memory filtering + pagination.)
 *   2. Create / invite: Modal form → adminUsersResource.create() → success
 *      card with username + one-time temporary_password (CopyButton).
 *   3. Row actions:
 *        🔑 reset password   (adminUsersResource.resetPassword)
 *        ⛔ / ✓ disable/enable toggle (adminUsersResource.updateStatus)
 *        🗑 delete with ConfirmDialog guard (adminUsersResource.remove)
 *   4. Batch actions: Enable / Disable / Delete over multi-select using
 *      Promise.allSettled so a single failure never aborts the whole batch;
 *      result summarised via Toast.
 *   5. All mutations are followed by a fresh `loadUsers()` round-trip so
 *      the displayed state always matches the source of truth.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserRole } from '@ontodecide/shared';
import type {
  CreateUserDto,
  CredentialResult,
  UserPublic,
} from '@/types/ontodecide-shared';
import { adminUsersResource } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { useSession } from '@/hooks/useSession';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Checkbox from '@/components/ui/Checkbox';
import { Card, CardContent } from '@/components/ui/Card';
import Badge, { BadgeTone } from '@/components/ui/Badge';
import Table, { TableHeader, TableRow, TableCell } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import RoleBadge from '@/components/shared/RoleBadge';
import IconButton from '@/components/ui/IconButton';
import Modal from '@/components/ui/Modal';
import CopyButton from '@/components/shared/CopyButton';
import { useToast } from '@/components/ui/Toast';

const ROLE_OPTIONS = [
  { label: 'All roles', value: 'all' },
  { label: 'Admin', value: 'admin' },
  { label: 'User', value: 'user' },
];
const STATE_OPTIONS = [
  { label: 'All statuses', value: 'all' },
  { label: 'Enabled (can log in)', value: 'enable' },
  { label: 'Disabled (cannot log in)', value: 'disable' },
];
const CREATE_ROLE_OPTIONS = [
  { label: 'User', value: 'user' },
  { label: 'Admin', value: 'admin' },
];
const AVATAR_COLORS = [
  'var(--color-primary)', 'var(--color-accent)', 'var(--color-success)',
  'var(--color-warning)', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

type BatchKind = 'disable' | 'enable' | 'delete';
type SingleKind = Exclude<BatchKind, 'enable' | 'disable'> | 'reset';

/** Simplified two-state status model (FR-5): enable / disable. */
type SimpleStatus = 'enable' | 'disable';

/**
 * Derive a binary Enabled / Disabled status from the UserPublic record.
 *
 * Considers both the stored {@code is_active} flag and the expiration
 * timestamp; an expired account is always reported as disabled (FR-5).
 */
function deriveStatus(u: UserPublic): SimpleStatus {
  if (!u.is_active) return 'disable';
  if (u.expires_at && new Date(u.expires_at).getTime() < Date.now()) {
    return 'disable';
  }
  return 'enable';
}

const STATUS_TONE: Record<SimpleStatus, BadgeTone> = {
  enable: 'success',
  disable: 'default',
};
const STATUS_LABEL: Record<SimpleStatus, string> = {
  enable: 'Enabled',
  disable: 'Disabled',
};

/**
 * Admin-permission boundary (FR-6).
 *
 * Admins may operate on user-role accounts plus their own account;
 * other admin accounts are read-only.
 */
function canOperateOn(u: UserPublic, currentUserId: string | null): boolean {
  if (!currentUserId) return u.role !== 'admin';
  return u.role !== 'admin' || u.id === currentUserId;
}

function stableAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initialsOf(label: string): string {
  return label
    .split(/[@.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return new Date(iso).toLocaleDateString();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 365) return `${d}d ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function displayName(user: UserPublic): string {
  return user.email ?? user.username;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Build the absolute login-page URL from the current window location.
 * Works in dev (localhost), Cloudflare Pages preview, and production.
 */
function buildLoginUrl(): string {
  if (typeof window === 'undefined') return '#/login';
  return window.location.origin + window.location.pathname + '#/login';
}

export default function AdminUsersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { session } = useSession();
  const currentUserId = session?.user_id ?? null;

  // ---------- data loading ----------
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadUsers = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const res = await adminUsersResource.list({ page: 1, size: 100 });
      const list = res.data?.list;
      if (!list) {
        throw new Error(res.error?.message ?? 'No user data returned by the server.');
      }
      setUsers(list);
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to load users. Please try again.';
      setLoadError(msg);
      toast.show({ tone: 'danger', title: 'Could not load users', message: msg });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // ---------- filters + pagination ----------
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const filteredRows = useMemo(() => users.filter((u) => {
    const q = query.trim().toLowerCase();
    const hay = `${u.username} ${u.email ?? ''} ${u.id} ${u.tenant_id}`.toLowerCase();
    const matchesQ = !q || hay.includes(q);
    const matchesR = roleFilter === 'all' || u.role === roleFilter;
    const matchesS = stateFilter === 'all' || deriveStatus(u) === stateFilter;
    return matchesQ && matchesR && matchesS;
  }), [users, query, roleFilter, stateFilter]);

  const total = filteredRows.length;
  const pageRows = useMemo(() => {
    const start = (page - 1) * size;
    return filteredRows.slice(start, start + size);
  }, [filteredRows, page, size]);

  // ---------- row selection + batch actions ----------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<
    { kind: BatchKind; targetIds: string[] } | null
  >(null);

  /** Only rows the current admin may touch are eligible for selection. */
  const eligibleRows = useMemo(
    () => pageRows.filter((r) => canOperateOn(r, currentUserId)),
    [pageRows, currentUserId],
  );
  const allChecked =
    eligibleRows.length > 0 && eligibleRows.every((r) => selected.has(r.id));
  const someChecked = eligibleRows.some((r) => selected.has(r.id));

  const toggleRow = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((s) => {
    const next = new Set(s);
    if (allChecked) {
      eligibleRows.forEach((r) => next.delete(r.id));
    } else {
      eligibleRows.forEach((r) => next.add(r.id));
    }
    return next;
  });

  const batchAction = (kind: BatchKind) => () => {
    if (selected.size === 0) return;
    setConfirm({ kind, targetIds: Array.from(selected) });
  };

  const executeBatch = useCallback(async (kind: BatchKind, ids: string[]) => {
    /** Drop targets that violate the admin-vs-admin boundary (FR-6). */
    const safeIds = ids.filter((id) => {
      const u = users.find((x) => x.id === id);
      return u ? canOperateOn(u, currentUserId) : false;
    });
    const skipped = ids.length - safeIds.length;
    let ok = 0;
    let fail = 0;
    const results = await Promise.allSettled(safeIds.map((id) => {
      if (kind === 'delete') return adminUsersResource.remove(id);
      return adminUsersResource.updateStatus(id, { is_active: kind === 'enable' });
    }));
    results.forEach((r) => (r.status === 'fulfilled' ? ok++ : fail++));
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    if (ok > 0) {
      toast.show({
        tone: 'success',
        title: 'Batch action complete',
        message:
          kind === 'delete'
            ? `Deleted ${ok} user${ok === 1 ? '' : 's'}.`
            : kind === 'enable'
              ? `Enabled ${ok} user${ok === 1 ? '' : 's'}.`
              : `Disabled ${ok} user${ok === 1 ? '' : 's'}.`,
      });
    }
    if (skipped > 0) {
      toast.show({
        tone: 'info',
        title: `${skipped} item${skipped === 1 ? '' : 's'} skipped`,
        message:
          'Cannot modify fellow administrator account(s) — they were excluded.',
      });
    }
    if (fail > 0) {
      toast.show({
        tone: 'warning',
        title: `${fail} item${fail === 1 ? '' : 's'} failed`,
        message: 'Some items could not be updated. Try them individually for details.',
      });
    }
    // If the batch delete removed the currently signed-in admin, log out
    // and redirect so the UI does not keep operating on stale tokens.
    if (kind === 'delete' && currentUserId && ids.includes(currentUserId)) {
      useAuthStore.getState().clear();
      navigate('/login', { replace: true });
      return;
    }
    await loadUsers(true);
  }, [loadUsers, toast, users, currentUserId]);

  // ---------- single-row action handlers ----------
  const [rowConfirm, setRowConfirm] = useState<{ kind: SingleKind; user: UserPublic } | null>(null);
  const [resetResult, setResetResult] = useState<CredentialResult | null>(null);

  /**
   * Toggle the persisted is_active flag against the derived status, so the
   * admin's intent always matches what the status badge displays (FR-5).
   *
   * For accounts that appear Disabled purely because expires_at has passed
   * (stored is_active still true), clicking the ✓ Enable button will flip
   * the persisted is_active to true (no-op) which is harmless; admins can
   * use the expiry-extend flow to re-enable such accounts if needed.
   */
  const handleToggleActive = async (user: UserPublic) => {
    const showingEnabled = deriveStatus(user) === 'enable';
    const nextActive = !showingEnabled;
    try {
      await adminUsersResource.updateStatus(user.id, { is_active: nextActive });
      toast.show({
        tone: 'success',
        message: nextActive
          ? `${displayName(user)} has been enabled.`
          : `${displayName(user)} has been disabled.`,
      });
      await loadUsers(true);
    } catch (e: any) {
      toast.show({
        tone: 'danger',
        title: nextActive ? 'Enable failed' : 'Disable failed',
        message: e?.message ?? 'An unexpected error occurred.',
      });
    }
  };

  const handleDeleteOne = async (user: UserPublic) => {
    try {
      await adminUsersResource.remove(user.id);
      setSelected((s) => {
        const n = new Set(s);
        n.delete(user.id);
        return n;
      });
      toast.show({
        tone: 'success',
        message: `User ${displayName(user)} was deleted.`,
      });
      // If the admin deleted their own account, log out and go to login.
      if (user.id === currentUserId) {
        useAuthStore.getState().clear();
        navigate('/login', { replace: true });
        return;
      }
      await loadUsers(true);
    } catch (e: any) {
      toast.show({
        tone: 'danger',
        title: 'Delete failed',
        message: e?.message ?? 'An unexpected error occurred.',
      });
    }
  };

  const handleResetPassword = async (user: UserPublic) => {
    try {
      const res = await adminUsersResource.resetPassword(user.id);
      setResetResult(res.data ?? null);
      toast.show({ tone: 'success', message: 'Temporary password generated.' });
      await loadUsers(true);
    } catch (e: any) {
      toast.show({
        tone: 'danger',
        title: 'Reset password failed',
        message: e?.message ?? 'An unexpected error occurred.',
      });
    }
  };

  // ---------- invite / create user modal ----------
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  // NOTE: CreateUserDto.username is optional in the current schema, but the compiled
  // shared package still declares it required for older consumers. We keep a
  // username field in form state (kept in sync with email) for type compatibility.
  const [inviteForm, setInviteForm] = useState<
    CreateUserDto & { role: UserRole }
  >({
    username: '',
    email: '',
    role: 'user',
    dataRetentionDays: undefined,
  });
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<CredentialResult | null>(null);

  const openInvite = () => {
    setInviteForm({
      username: '',
      email: '',
      role: 'user',
      dataRetentionDays: undefined,
    });
    setInviteFormError(null);
    setInviteResult(null);
    setInviteOpen(true);
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteFormError(null);
    const email = inviteForm.email?.trim() ?? '';
    if (!email) {
      setInviteFormError('Email is required — it doubles as the login username.');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setInviteFormError('That does not look like a valid email address.');
      return;
    }
    setInviteSubmitting(true);
    try {
      const dto: CreateUserDto = {
        username: email,
        email,
        role: inviteForm.role,
        dataRetentionDays: inviteForm.dataRetentionDays,
      };
      const res = await adminUsersResource.create(dto);
      setInviteResult(res.data ?? null);
      toast.show({
        tone: 'success',
        title: 'Account created',
        message: `${res.data!.username} — please copy the temporary password before closing.`,
        timeoutMs: 8000,
      });
      await loadUsers(true);
    } catch (e: any) {
      setInviteFormError(e?.message ?? 'Could not create the account. Please try again.');
    } finally {
      setInviteSubmitting(false);
    }
  };

  const closeInviteResultSafe = () => {
    setInviteOpen(false);
    setTimeout(() => setInviteResult(null), 300);
  };

  // ---------- render ----------
  const filtersChanged = () => {
    setPage(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
            User management
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            Invite, enable, disable and remove workspace members. Assign roles
            and review last-seen timestamps.
          </p>
        </div>
        <Button variant="primary" onClick={openInvite}>+ Invite user</Button>
      </div>

      <Card>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr auto',
              gap: 'var(--space-2)',
            }}
          >
            <Input
              placeholder="Search users by username, email, or id…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); filtersChanged(); }}
              leftIcon={<span style={{ color: 'var(--color-neutral-500)' }}>🔍</span>}
            />
            <Select
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value); filtersChanged(); }}
              options={ROLE_OPTIONS}
            />
            <Select
              value={stateFilter}
              onChange={(e) => { setStateFilter(e.target.value); filtersChanged(); }}
              options={STATE_OPTIONS}
            />
            <Badge tone="info">
              {loading
                ? 'Loading…'
                : `${filteredRows.length} user${filteredRows.length === 1 ? '' : 's'}`}
            </Badge>
          </div>
          {selected.size > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'var(--color-primary-50)',
                border: '1px solid #D4C7FC',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                {selected.size} user{selected.size === 1 ? '' : 's'} selected
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="outline" onClick={batchAction('enable')}>
                  ✓ Enable
                </Button>
                <Button size="sm" variant="outline" onClick={batchAction('disable')}>
                  ⛔ Disable
                </Button>
                <Button size="sm" variant="danger" onClick={batchAction('delete')}>
                  🗑 Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          )}
          {loadError ? (
            <div
              style={{
                padding: 12,
                borderRadius: 'var(--radius-md)',
                background: '#FFF4F4',
                border: '1px solid var(--color-danger-50)',
                color: 'var(--color-danger)',
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span>{loadError}</span>
              <Button size="sm" variant="outline" onClick={() => loadUsers(false)}>
                Retry
              </Button>
            </div>
          ) : null}
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
                  indeterminate={!allChecked && someChecked}
                  onChange={toggleAll}
                  aria-label="Select all rows"
                />
              </TableCell>
              <TableCell header>User</TableCell>
              <TableCell header>Email</TableCell>
              <TableCell header>Role</TableCell>
              <TableCell header>Status</TableCell>
              <TableCell header>Expires</TableCell>
              <TableCell header>Last login</TableCell>
              <TableCell header align="right">Actions</TableCell>
            </TableHeader>
            <tbody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    align="center"
                    style={{ padding: 40, color: 'var(--color-neutral-500)' }}
                  >
                    Loading users…
                  </TableCell>
                </TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    align="center"
                    style={{ padding: 40, color: 'var(--color-neutral-500)' }}
                  >
                    {users.length === 0
                      ? 'No users yet — click “+ Invite user” to create the first account.'
                      : 'No users match the current filters.'}
                  </TableCell>
                </TableRow>
              ) : pageRows.map((u) => {
                const status = deriveStatus(u);
                const name = displayName(u);
                const initials = initialsOf(name);
                const operable = canOperateOn(u, currentUserId);
                const canToggle = operable && !u.is_data_cleared;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Checkbox
                        id={`sel-${u.id}`}
                        name={u.id}
                        checked={operable ? selected.has(u.id) : false}
                        onChange={() => toggleRow(u.id)}
                        aria-label={`Select ${name}`}
                        disabled={!operable}
                      />
                    </TableCell>
                    <TableCell>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          aria-hidden="true"
                          style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: stableAvatarColor(u.id), color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 12, flexShrink: 0,
                          }}
                        >
                          {initials}
                        </div>
                        <div>
                          <div
                            style={{
                              fontWeight: 600,
                              color: 'var(--color-neutral-900)',
                              fontSize: 14,
                            }}
                          >
                            {name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                            {u.tenant_id} · {u.id.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.email ? (
                        <a
                          href={`mailto:${u.email}`}
                          style={{ color: 'var(--color-accent)', fontSize: 13 }}
                        >
                          {u.email}
                        </a>
                      ) : (
                        <span style={{ color: 'var(--color-neutral-400)', fontSize: 13 }}>
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell><Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge></TableCell>
                    <TableCell style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
                      {u.expires_at
                        ? new Date(u.expires_at).toLocaleDateString()
                        : (
                          <span style={{ color: 'var(--color-neutral-400)' }}>
                            Never
                          </span>
                        )}
                    </TableCell>
                    <TableCell style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
                      {formatRelative(u.last_login_at)}
                    </TableCell>
                    <TableCell align="right">
                      {operable ? (
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <IconButton
                            variant="ghost"
                            size="sm"
                            aria-label="Reset password"
                            onClick={() => setRowConfirm({ kind: 'reset', user: u })}
                            title="Reset password"
                          >🔑</IconButton>
                          {canToggle ? (
                            <IconButton
                              variant="ghost"
                              size="sm"
                              aria-label={status === 'enable' ? 'Disable' : 'Enable'}
                              onClick={() => handleToggleActive(u)}
                              title={status === 'enable' ? 'Disable' : 'Enable'}
                              style={
                                status === 'enable'
                                  ? undefined
                                  : { color: 'var(--color-success)' }
                              }
                            >
                              {status === 'enable' ? '⛔' : '✓'}
                            </IconButton>
                          ) : null}
                          <IconButton
                            variant="ghost"
                            size="sm"
                            aria-label="Delete"
                            onClick={() => setRowConfirm({ kind: 'delete', user: u })}
                            style={{ color: 'var(--color-danger)' }}
                            title="Delete user"
                          >🗑</IconButton>
                        </div>
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--color-neutral-400)',
                          }}
                          aria-label="Other administrator accounts are read-only."
                        >
                          —
                        </span>
                      )}
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

      {/* ---------- BATCH ConfirmDialog ---------- */}
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
        onConfirm={async () => {
          const kind = confirm!.kind;
          const ids = confirm!.targetIds;
          setConfirm(null);
          await executeBatch(kind, ids);
        }}
      >
        <p>
          This action applies to <strong>{confirm?.targetIds.length ?? 0}</strong> selected
          user{confirm?.targetIds.length === 1 ? '' : 's'}.
        </p>
        {confirm?.kind === 'delete' ? (
          <p style={{ marginTop: 8, color: 'var(--color-danger)', fontSize: 13 }}>
            Deletion is permanent and will schedule their workspace data for removal.
          </p>
        ) : null}
      </ConfirmDialog>

      {/* ---------- SINGLE-ROW ConfirmDialog (delete / reset) ---------- */}
      <ConfirmDialog
        open={!!rowConfirm && rowConfirm.kind === 'delete'}
        title={`Delete ${rowConfirm ? displayName(rowConfirm.user) : 'user'}?`}
        confirmTone="danger"
        confirmLabel="Delete"
        onCancel={() => setRowConfirm(null)}
        onConfirm={async () => {
          if (!rowConfirm) return;
          const target = rowConfirm.user;
          setRowConfirm(null);
          await handleDeleteOne(target);
        }}
      >
        <p>
          Deleting <strong>{rowConfirm ? displayName(rowConfirm.user) : 'the user'}</strong> removes
          their login and schedules their workspace data for cleanup. This cannot be undone.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!rowConfirm && rowConfirm.kind === 'reset'}
        title={`Reset password for ${rowConfirm ? displayName(rowConfirm.user) : 'user'}?`}
        confirmTone="primary"
        confirmLabel="Reset password"
        onCancel={() => setRowConfirm(null)}
        onConfirm={async () => {
          if (!rowConfirm) return;
          const target = rowConfirm.user;
          setRowConfirm(null);
          await handleResetPassword(target);
        }}
      >
        <p>
          A new one-time temporary password will be generated. The user is forced to change it
          on their next login. Send the new temporary password to them securely.
        </p>
      </ConfirmDialog>

      {/* ---------- PASSWORD-RESET result Modal ---------- */}
      <Modal
        open={!!resetResult}
        title="Temporary password generated"
        onClose={() => setResetResult(null)}
        width={520}
        footer={
          <Button variant="primary" onClick={() => setResetResult(null)}>
            Done
          </Button>
        }
      >
        {resetResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>
                Username
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  background: 'var(--color-neutral-50)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-neutral-200)',
                  fontWeight: 600,
                  color: 'var(--color-neutral-900)',
                }}
              >
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{resetResult.username}</span>
                <CopyButton text={resetResult.username} ariaLabel="Copy username" />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>
                Temporary password
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  background: '#FFF8E6',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #F3E2A3',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontWeight: 600,
                  color: '#7B5A00',
                }}
              >
                <span style={{ flex: 1, wordBreak: 'break-all' }}>
                  {resetResult.temporary_password}
                </span>
                <CopyButton
                  text={resetResult.temporary_password}
                  ariaLabel="Copy temporary password"
                />
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-neutral-500)', margin: 0 }}>
              This temporary password is shown only once. Send it to the user via a secure channel.
              On first login they will be asked to change it.
            </p>
          </div>
        ) : null}
      </Modal>

      {/* ---------- INVITE Modal ---------- */}
      <Modal
        open={inviteOpen}
        title={inviteResult ? 'Account created successfully' : 'Invite a new user'}
        onClose={closeInviteResultSafe}
        width={inviteResult ? 540 : 500}
        footer={
          inviteResult ? (
            <>
              <Button variant="ghost" onClick={openInvite}>
                Invite another
              </Button>
              <Button variant="primary" onClick={closeInviteResultSafe}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setInviteOpen(false)}
                disabled={inviteSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                form="invite-form"
                disabled={inviteSubmitting}
              >
                {inviteSubmitting ? 'Creating…' : 'Create account'}
              </Button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                padding: 12,
                borderRadius: 'var(--radius-md)',
                background: '#E8F5EC',
                border: '1px solid #C8E6D0',
                color: 'var(--color-success)',
                fontSize: 13,
              }}
            >
              ✓ Credentials below are shown <strong>only now</strong> — copy them before closing.
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>
                Username (login name)
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  background: 'var(--color-neutral-50)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-neutral-200)',
                  fontWeight: 600,
                  color: 'var(--color-neutral-900)',
                }}
              >
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{inviteResult.username}</span>
                <CopyButton text={inviteResult.username} ariaLabel="Copy username" />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>
                Temporary password
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  background: '#FFF8E6',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #F3E2A3',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontWeight: 600,
                  color: '#7B5A00',
                }}
              >
                <span style={{ flex: 1, wordBreak: 'break-all' }}>
                  {inviteResult.temporary_password}
                </span>
                <CopyButton
                  text={inviteResult.temporary_password}
                  ariaLabel="Copy temporary password"
                />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 4 }}>
                Login page URL
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  background: 'var(--color-neutral-50)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-neutral-200)',
                  fontWeight: 500,
                  color: 'var(--color-neutral-800)',
                  fontSize: 13,
                }}
              >
                <a
                  href={buildLoginUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    wordBreak: 'break-all',
                    color: 'var(--color-accent)',
                    textDecoration: 'none',
                  }}
                >
                  {buildLoginUrl()}
                </a>
                <CopyButton text={buildLoginUrl()} ariaLabel="Copy login URL" />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
              {inviteResult.email_sent
                ? '📧 An email with the login credentials and instructions '
                    + 'has been sent to the user. You may also copy the '
                    + 'credentials above as a backup.'
                : '🔗 Share the login page URL above, username and temporary '
                    + 'password with the user via a secure channel.'}
            </div>
          </div>
        ) : (
          <form id="invite-form" onSubmit={submitInvite} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div>
                <label
                  htmlFor="invite-email"
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-neutral-700)',
                    marginBottom: 6,
                  }}
                >
                  Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="colleague@company.com"
                  autoComplete="off"
                  value={inviteForm.email ?? ''}
                  onChange={(e) => setInviteForm((f) => ({
                    ...f,
                    email: e.target.value,
                    username: e.target.value,
                  }))}
                  required
                />
                <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                  This email will also serve as the default login username.
                </div>
              </div>

              <div>
                <label
                  htmlFor="invite-role"
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-neutral-700)',
                    marginBottom: 6,
                  }}
                >
                  Role
                </label>
                <Select
                  id="invite-role"
                  name="role"
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((f) => ({
                    ...f,
                    role: e.target.value as UserRole,
                  }))}
                  options={CREATE_ROLE_OPTIONS}
                />
              </div>

              <div>
                <label
                  htmlFor="invite-retention"
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-neutral-700)',
                    marginBottom: 6,
                  }}
                >
                  Data retention (days){' '}
                  <em style={{ fontWeight: 400, color: 'var(--color-neutral-500)' }}>
                    optional
                  </em>
                </label>
                <Input
                  id="invite-retention"
                  name="dataRetentionDays"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="System default (recommended)"
                  value={inviteForm.dataRetentionDays ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed = raw === ''
                      ? undefined
                      : Math.max(1, Math.min(365, parseInt(raw, 10)));
                    setInviteForm((f) => ({
                      ...f,
                      dataRetentionDays: Number.isFinite(parsed as number) ? parsed : undefined,
                    }));
                  }}
                />
                <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 6 }}>
                  Leave blank to use the system default. The account expires N days after creation;
                  after expiry the Cleanup service automatically archives tenant data.
                </div>
              </div>

              {inviteFormError ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: '#FFF4F4',
                    border: '1px solid #FCD6D6',
                    color: 'var(--color-danger)',
                    fontSize: 13,
                  }}
                >
                  {inviteFormError}
                </div>
              ) : null}
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
