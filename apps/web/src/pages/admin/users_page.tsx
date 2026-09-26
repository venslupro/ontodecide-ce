/**
 * @fileoverview Users & permissions (Admin): users table with inline role
 * change, markings, enable/disable, password reset (one-time temporary
 * password), delete with typed confirmation; the signed-in admin cannot
 * disable, demote or delete themselves.
 */

import type {UserDto} from '@ontodecide/identity/contract';
import type {Role} from '@ontodecide/shared-kernel';
import {ROLES} from '@ontodecide/shared-kernel';
import {
  KeyRound,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {
  useDeleteUser,
  useResetPassword,
  useUpdateUser,
  useUsers,
} from '../../features/identity/api';
import {CreateUserDialog} from '../../features/identity/components/create_user_dialog';
import {MarkingsDialog} from '../../features/identity/components/markings_dialog';
import {
  TemporaryPasswordDialog,
  type OneTimeSecret,
} from '../../features/identity/components/temporary_password_dialog';
import {errorMessage} from '../../shared/api/error_message';
import {useDebouncedValue, useOnline} from '../../shared/lib/hooks';
import {fmt} from '../../shared/lib/format';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Input} from '../../shared/ui/input';
import {PageHeader} from '../../shared/ui/page_header';
import {NativeSelect} from '../../shared/ui/select';
import {Skeleton} from '../../shared/ui/skeleton';
import {Switch} from '../../shared/ui/switch';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';
import {ConfirmDialog} from './confirm_dialog';

/** Users & permissions page. */
export function UsersPage() {
  const {t} = useTranslation('admin');
  const online = useOnline();
  const selfId = useSession(s => s.user?.id);
  const users = useUsers();
  const update = useUpdateUser();
  const reset = useResetPassword();
  const del = useDeleteUser();
  const [q, setQ] = useState('');
  const query = useDebouncedValue(q.trim().toLowerCase());
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const [markingsFor, setMarkingsFor] = useState<UserDto | null>(null);
  const [resetFor, setResetFor] = useState<UserDto | null>(null);
  const [deleteFor, setDeleteFor] = useState<UserDto | null>(null);

  const list = useMemo(() => users.data ?? [], [users.data]);
  const filtered = useMemo(
    () =>
      query
        ? list.filter(
            u =>
              u.name.toLowerCase().includes(query) ||
              u.email.toLowerCase().includes(query),
          )
        : list,
    [list, query],
  );
  const knownMarkings = useMemo(
    () => Array.from(new Set(list.flatMap(u => u.markings))).sort(),
    [list],
  );

  const changeRole = (u: UserDto, role: Role) => {
    update.mutate(
      {id: u.id, patch: {role}},
      {
        onSuccess: () =>
          toast.success(
            t('users.roleChanged', {
              name: u.name,
              role: t(`common:roles.${role}`),
            }),
          ),
        onError: e => toast.error(t('users.updateFailed'), errorMessage(e, t)),
      },
    );
  };

  const toggleDisabled = (u: UserDto, enabled: boolean) => {
    update.mutate(
      {id: u.id, patch: {disabled: !enabled}},
      {
        onSuccess: () =>
          toast.success(
            enabled
              ? t('users.enabled', {name: u.name})
              : t('users.disabled', {name: u.name}),
          ),
        onError: e => toast.error(t('users.updateFailed'), errorMessage(e, t)),
      },
    );
  };

  const confirmReset = () => {
    const u = resetFor;
    if (!u) return;
    reset.mutate(u.id, {
      onSuccess: r => {
        setResetFor(null);
        setSecret({
          email: u.email,
          password: r.temporaryPassword,
          reason: 'reset',
        });
      },
      onError: e => toast.error(t('reset.failed'), errorMessage(e, t)),
    });
  };

  const confirmDelete = () => {
    const u = deleteFor;
    if (!u) return;
    del.mutate(u.id, {
      onSuccess: () => {
        setDeleteFor(null);
        toast.success(t('delete.done', {name: u.name}));
      },
      onError: e => toast.error(t('delete.failed'), errorMessage(e, t)),
    });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={
          <CreateUserDialog
            markingSuggestions={knownMarkings}
            onCreated={(u, pw) => {
              toast.success(t('users.created', {name: u.name}));
              if (pw)
                setSecret({email: u.email, password: pw, reason: 'created'});
            }}
          />
        }
      />
      <Panel
        title={t('users.listTitle')}
        subtitle={
          users.data ? t('common:state.total', {count: list.length}) : undefined
        }
        icon={<Users aria-hidden />}
        bodyClassName="px-0"
        actions={
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-dim"
              aria-hidden
            />
            <Input
              inputSize="sm"
              className="w-56 pl-7"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('users.search')}
              aria-label={t('users.search')}
            />
          </div>
        }
      >
        {users.isLoading && (
          <div className="flex flex-col gap-2 px-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
        {users.isError && (
          <ErrorView
            detail={errorMessage(users.error, t)}
            onRetry={() => void users.refetch()}
          />
        )}
        {users.data && filtered.length === 0 && (
          <EmptyState title={t('common:state.noResults')} />
        )}
        {filtered.length > 0 && (
          <Table aria-label={t('users.listTitle')}>
            <THead>
              <tr className="border-b border-line">
                <Th className="pl-4">{t('fields.user')}</Th>
                <Th>{t('fields.role')}</Th>
                <Th>{t('fields.markings')}</Th>
                <Th>{t('fields.status')}</Th>
                <Th>{t('fields.lastLogin')}</Th>
                <Th>{t('fields.createdAt')}</Th>
                <Th className="pr-4 text-right">{t('fields.actions')}</Th>
              </tr>
            </THead>
            <TBody>
              {filtered.map(u => {
                const self = u.id === selfId;
                const busy = update.isPending && update.variables?.id === u.id;
                return (
                  <Tr
                    key={u.id}
                    className={u.disabled ? 'opacity-70' : undefined}
                  >
                    <Td className="pl-4">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        {u.name}
                        {self && <Badge tone="cyan">{t('users.you')}</Badge>}
                        {u.mustChangePassword && (
                          <Badge tone="warn">{t('users.mustChange')}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </Td>
                    <Td className="min-w-32">
                      <NativeSelect
                        size="sm"
                        aria-label={t('users.roleAria', {name: u.name})}
                        title={self ? t('users.selfRole') : undefined}
                        disabled={self || !online || busy}
                        options={ROLES.map(r => ({
                          value: r,
                          label: t(`common:roles.${r}`),
                        }))}
                        value={u.role}
                        onChange={e => changeRole(u, e.target.value as Role)}
                      />
                    </Td>
                    <Td>
                      <div className="flex max-w-64 flex-wrap items-center gap-1">
                        {u.markings.length === 0 && (
                          <span className="text-xs text-dim">
                            {t('users.noMarkings')}
                          </span>
                        )}
                        {u.markings.map(m => (
                          <Badge key={m} tone="orange">
                            <ShieldCheck aria-hidden />
                            {m}
                          </Badge>
                        ))}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('users.editMarkings', {name: u.name})}
                          title={t('users.editMarkings', {name: u.name})}
                          disabled={!online}
                          onClick={() => setMarkingsFor(u)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                      </div>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Switch
                          checked={!u.disabled}
                          disabled={self || !online || busy}
                          aria-label={t('users.enabledAria', {name: u.name})}
                          title={self ? t('users.selfDisable') : undefined}
                          onCheckedChange={v => toggleDisabled(u, v)}
                        />
                        <span
                          className={
                            u.disabled
                              ? 'text-xs text-dim'
                              : 'text-xs text-good'
                          }
                        >
                          {u.disabled
                            ? t('users.statusDisabled')
                            : t('users.statusActive')}
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {u.lastLoginAt
                        ? fmt.ago(u.lastLoginAt)
                        : t('users.never')}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {fmt.date(u.createdAt)}
                    </Td>
                    <Td className="pr-4">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('users.resetAria', {name: u.name})}
                          title={t('users.resetAria', {name: u.name})}
                          disabled={!online}
                          onClick={() => setResetFor(u)}
                        >
                          <KeyRound aria-hidden />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="hover:text-crit"
                          aria-label={t('users.deleteAria', {name: u.name})}
                          title={
                            self
                              ? t('users.selfDelete')
                              : t('users.deleteAria', {name: u.name})
                          }
                          disabled={self || !online}
                          onClick={() => setDeleteFor(u)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>

      <MarkingsDialog
        user={markingsFor}
        suggestions={knownMarkings}
        onClose={() => setMarkingsFor(null)}
      />

      <ConfirmDialog
        open={!!resetFor}
        onOpenChange={o => !o && setResetFor(null)}
        title={t('reset.title', {name: resetFor?.name ?? ''})}
        description={t('reset.description')}
        confirmLabel={t('reset.confirm')}
        loading={reset.isPending}
        disabled={!online}
        onConfirm={confirmReset}
      />

      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={o => !o && setDeleteFor(null)}
        tone="danger"
        title={t('delete.title', {name: deleteFor?.name ?? ''})}
        description={t('delete.description')}
        confirmLabel={t('delete.confirm')}
        loading={del.isPending}
        disabled={!online || deleteFor?.id === selfId}
        typeToConfirm={deleteFor?.email}
        typeLabel={t('delete.typeLabel', {email: deleteFor?.email ?? ''})}
        onConfirm={confirmDelete}
      />

      <TemporaryPasswordDialog
        secret={secret}
        onClose={() => setSecret(null)}
      />
    </div>
  );
}
