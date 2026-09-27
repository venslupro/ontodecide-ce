/**
 * @fileoverview Admin workspace table (效果图 c9 "工作区"): full e-mail,
 * status (ACTIVE / EXPIRED / ARCHIVING / derived ARCHIVE_ONLY shown as
 * "账户已删除"), remaining time or ZIP deletion, 对象 / 关系; "进入" (admin
 * view) and "管理 ▾" (account details, extend / shorten trial with impact,
 * end trial, revoke sessions, delete with optional archive — the reason is
 * required only without an archive —, ban). ARCHIVE_ONLY rows offer
 * "下载 ZIP" and a "管理 ▾" with download / delete archive. The details
 * dialog reads GET /admin/users/{uid} (audited server-side).
 */

import type {
  AdminUserRow,
  PlatformOverview,
} from '@ontodecide/identity/contract';
import {LIFECYCLE} from '@ontodecide/shared-kernel';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {ChevronDown, Download} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {serverNow} from '../../entities/session/store';
import {enterActAs} from '../../features/admin/act_as';
import {
  archiveLink,
  deleteArchiveAdmin,
  deleteUser,
  invalidateAdmin,
  patchUser,
  revokeSessions,
  useAdminUser,
  useAdminUsers,
} from '../../features/admin/api';
import {AdminConfirmDialog} from '../../features/admin/components/confirm_dialog';
import {idempotencyKey} from '../../shared/api/client';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {openDownloadLink} from '../../shared/lib/download';
import {fmt, shortTid} from '../../shared/lib/format';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown_menu';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {Checkbox, Field, Input, Label, Textarea} from '../../shared/ui/input';
import {Skeleton} from '../../shared/ui/skeleton';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';

type Action =
  'trial' | 'end' | 'revoke' | 'delete' | 'ban' | 'details' | 'deleteArchive';

const STATUS_TONE = {
  ACTIVE: 'good',
  EXPIRED: 'crit',
  ARCHIVING: 'warn',
  ARCHIVE_ONLY: 'warn',
} as const;

/** Time column: remaining trial, archiving, or ZIP deletion. */
export function timeCell(
  row: AdminUserRow,
  now: number,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (row.status === 'ARCHIVE_ONLY') {
    const at = row.zipExpiresAt ? Date.parse(row.zipExpiresAt) : NaN;
    if (Number.isNaN(at)) return '—';
    return t('users.zipIn', {
      days: Math.max(0, Math.ceil((at - now) / 86_400_000)),
    });
  }
  if (row.status === 'ARCHIVING') return t('users.archiving');
  if (row.status === 'EXPIRED') return t('users.expired');
  const at = row.trialExpiresAt ? Date.parse(row.trialExpiresAt) : NaN;
  if (Number.isNaN(at)) return '—';
  return t('users.left', {time: fmt.remaining(Math.max(0, at - now))});
}

/** `datetime-local` value for an ISO time. */
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 24 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function TrialImpact({
  row,
  next,
  overview,
}: {
  row: AdminUserRow;
  next: number;
  overview?: PlatformOverview;
}) {
  const {t} = useTranslation('admin');
  const cur = row.trialExpiresAt ? Date.parse(row.trialExpiresAt) : NaN;
  if (Number.isNaN(next)) return null;
  const deltaH = Number.isNaN(cur) ? 0 : Math.round((next - cur) / 3_600_000);
  const past = next <= serverNow();
  return (
    <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
      <li>
        {deltaH >= 0
          ? t('trial.impactExtend', {hours: deltaH})
          : t('trial.impactShorten', {hours: -deltaH})}
      </li>
      {past ? (
        <li className="text-warn">
          {t('trial.impactEnds', {min: LIFECYCLE.archiveDelayMin})}
        </li>
      ) : (
        <li>
          {t('trial.impactSlot', {
            used: overview?.activeTrials.used ?? '—',
            limit: overview?.activeTrials.limit ?? '—',
          })}
        </li>
      )}
      <li>{t('trial.impactWrites')}</li>
      <li>{t('trial.impactSessions')}</li>
    </ul>
  );
}

function ActionDialog({
  row,
  action,
  onClose,
  overview,
}: {
  row: AdminUserRow;
  action: Action;
  onClose(): void;
  overview?: PlatformOverview;
}) {
  const {t} = useTranslation('admin');
  const qc = useQueryClient();
  const [expires, setExpires] = useState(toLocalInput(row.trialExpiresAt));
  const [reason, setReason] = useState('');
  const [archive, setArchive] = useState(true);
  const uid = row.userId ?? '';
  const nextMs = Date.parse(expires);
  const target = {tenantId: row.tenantId, email: row.email};
  const done = () => {
    toast.success(t('done'));
    void invalidateAdmin(qc);
  };
  const common = {
    open: true,
    onOpenChange: (v: boolean) => !v && onClose(),
    target,
    onDone: done,
  };
  const reasonField = (required: boolean) => (
    <Field
      label={t('reason.label')}
      htmlFor="admin-reason"
      hint={required ? t('reason.required') : t('reason.optional')}
      required={required}
    >
      <Textarea
        id="admin-reason"
        maxLength={500}
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
    </Field>
  );

  switch (action) {
    case 'details':
      return <UserDetailsDialog uid={uid} onClose={onClose} />;
    case 'deleteArchive':
      return (
        <AdminConfirmDialog
          {...common}
          highRisk
          danger
          title={t('archives.deleteTitle')}
          description={t('archives.deleteBody')}
          confirmLabel={t('archives.delete')}
          onConfirm={w => deleteArchiveAdmin(row.tenantId, w)}
        />
      );
    case 'trial':
      return (
        <AdminConfirmDialog
          {...common}
          highRisk
          title={t('trial.title')}
          confirmLabel={t('trial.confirm')}
          disabled={Number.isNaN(nextMs) || !reason.trim()}
          onConfirm={w =>
            patchUser(
              uid,
              {
                trialExpiresAt: new Date(nextMs).toISOString(),
                reason: reason.trim(),
              },
              w,
            )
          }
        >
          <Field label={t('trial.newExpiry')} htmlFor="trial-expiry">
            <Input
              id="trial-expiry"
              type="datetime-local"
              value={expires}
              onChange={e => setExpires(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[-24, 24, 48].map(h => (
              <Button
                key={h}
                size="sm"
                onClick={() => {
                  const base = Number.isNaN(nextMs) ? Date.now() : nextMs;
                  setExpires(
                    toLocalInput(new Date(base + h * 3_600_000).toISOString()),
                  );
                }}
              >
                {h > 0 ? `+${h} h` : `${h} h`}
              </Button>
            ))}
          </div>
          <TrialImpact row={row} next={nextMs} overview={overview} />
          {reasonField(true)}
        </AdminConfirmDialog>
      );
    case 'end':
      return (
        <AdminConfirmDialog
          {...common}
          highRisk
          danger
          title={t('end.title')}
          description={t('end.body', {min: LIFECYCLE.archiveDelayMin})}
          confirmLabel={t('end.confirm')}
          disabled={!reason.trim()}
          onConfirm={w =>
            patchUser(uid, {status: 'EXPIRED', reason: reason.trim()}, w)
          }
        >
          {reasonField(true)}
        </AdminConfirmDialog>
      );
    case 'revoke':
      return (
        <AdminConfirmDialog
          {...common}
          title={t('revoke.title')}
          description={t('revoke.body')}
          confirmLabel={t('revoke.confirm')}
          onConfirm={w => revokeSessions(uid, w)}
        />
      );
    case 'ban':
      return (
        <AdminConfirmDialog
          {...common}
          highRisk
          danger={!row.banned}
          title={row.banned ? t('ban.unbanTitle') : t('ban.title')}
          description={row.banned ? undefined : t('ban.body')}
          confirmLabel={row.banned ? t('ban.unban') : t('ban.confirm')}
          disabled={!reason.trim()}
          onConfirm={w =>
            patchUser(uid, {banned: !row.banned, reason: reason.trim()}, w)
          }
        >
          {reasonField(true)}
        </AdminConfirmDialog>
      );
    case 'delete':
    default:
      return (
        <AdminConfirmDialog
          {...common}
          highRisk
          danger
          title={t('delete.title')}
          description={
            archive ? t('delete.bodyArchive') : t('delete.bodyNoArchive')
          }
          confirmLabel={t('delete.confirm')}
          disabled={!archive && !reason.trim()}
          onConfirm={w => deleteUser(uid, archive, reason, w)}
        >
          <div className="flex items-center gap-2">
            <Checkbox
              id="delete-archive"
              checked={archive}
              onCheckedChange={v => setArchive(v === true)}
            />
            <Label htmlFor="delete-archive" className="text-sm text-text">
              {t('delete.archive')}
            </Label>
          </div>
          {reasonField(!archive)}
        </AdminConfirmDialog>
      );
  }
}

/** Account details (GET /admin/users/{uid}; the view is audited). */
export function UserDetailsDialog({
  uid,
  onClose,
}: {
  uid: string;
  onClose(): void;
}) {
  const {t} = useTranslation('admin');
  const q = useAdminUser(uid);
  const u = q.data;
  const time = (iso: string | null | undefined) =>
    iso ? fmt.dateTimeTz(iso, u?.timeZone) : t('detail.none');
  const rows: [string, string][] = u
    ? [
        [t('detail.email'), u.email ?? t('users.deleted')],
        [t('detail.status'), u.status],
        [t('detail.locale'), u.locale],
        [t('detail.timeZone'), u.timeZone],
        [t('detail.verifiedAt'), time(u.verifiedAt)],
        [t('detail.trialExpiresAt'), time(u.trialExpiresAt)],
        [
          t('detail.expiredAt'),
          u.expiredAt ? time(u.expiredAt) : t('detail.notExpired'),
        ],
        [t('detail.archivePhase'), u.archivePhase ?? t('detail.none')],
        [t('detail.sessions'), String(u.sessions)],
        [t('detail.objectsLinks'), `${u.objects} / ${u.links}`],
        [t('detail.banned'), u.banned ? t('detail.yes') : t('detail.no')],
      ]
    : [];
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={t('detail.title')}
        description={t('detail.audited')}
        size="md"
      >
        {q.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : q.error ? (
          <p role="alert" className="text-sm text-crit">
            {errorMessage(q.error, t)}
          </p>
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="min-w-0 break-all text-text">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Opens a 15-minute archive link by top-level navigation. */
export async function downloadArchive(
  tid: string,
  onError: (e: unknown) => void,
): Promise<void> {
  try {
    const r = await archiveLink(tid, {idempotencyKey: idempotencyKey()});
    openDownloadLink(r.url);
  } catch (e) {
    onError(e);
  }
}

/** Users table panel. */
export function UsersPanel({overview}: {overview?: PlatformOverview}) {
  const {t} = useTranslation('admin');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const users = useAdminUsers();
  const [dialog, setDialog] = useState<{
    row: AdminUserRow;
    action: Action;
  } | null>(null);
  const rows = users.data?.pages.flatMap(p => p.items) ?? [];
  const now = serverNow();

  const enter = (row: AdminUserRow) => {
    enterActAs(qc, {tenantId: row.tenantId, email: row.email});
    void navigate({to: '/cockpit'});
  };

  return (
    <Panel
      title={t('users.title')}
      actions={<span className="text-xs text-muted">{t('users.hint')}</span>}
    >
      <Table aria-label={t('users.title')}>
        <THead>
          <Tr>
            <Th>{t('users.id')}</Th>
            <Th>{t('users.email')}</Th>
            <Th>{t('users.status')}</Th>
            <Th>{t('users.time')}</Th>
            <Th>{t('users.objectsLinks')}</Th>
            <Th className="text-right">{t('users.actions')}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map(row => {
            const archiveOnly = row.status === 'ARCHIVE_ONLY';
            return (
              <Tr key={`${row.tenantId}-${row.userId ?? ''}`}>
                <Td className="font-mono text-xs" title={row.tenantId}>
                  {shortTid(row.tenantId)}
                </Td>
                <Td className={archiveOnly ? 'text-muted' : ''}>
                  {row.email ?? t('users.deleted')}
                  {row.banned && (
                    <Badge tone="crit" className="ml-2">
                      {t('users.banned')}
                    </Badge>
                  )}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[row.status]}>● {row.status}</Badge>
                </Td>
                <Td className="num">{timeCell(row, now, t)}</Td>
                <Td className="num text-muted">
                  {archiveOnly ? '—' : `${row.objects} / ${row.links}`}
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {archiveOnly ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          void downloadArchive(row.tenantId, e =>
                            toast.error(errorMessage(e, t), undefined, {
                              traceId: errorTraceId(e),
                            }),
                          )
                        }
                      >
                        <Download aria-hidden />
                        {t('users.downloadZip')}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => enter(row)}>
                        {t('enter')}
                      </Button>
                    )}
                    {archiveOnly && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            aria-label={`${t('manage')} ${row.tenantId}`}
                          >
                            {t('manage')}
                            <ChevronDown aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onSelect={() =>
                              void downloadArchive(row.tenantId, e =>
                                toast.error(errorMessage(e, t), undefined, {
                                  traceId: errorTraceId(e),
                                }),
                              )
                            }
                          >
                            {t('menu.downloadZip')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-crit"
                            onSelect={() =>
                              setDialog({row, action: 'deleteArchive'})
                            }
                          >
                            {t('menu.deleteArchive')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {!archiveOnly && row.userId && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            aria-label={`${t('manage')} ${row.email ?? row.tenantId}`}
                          >
                            {t('manage')}
                            <ChevronDown aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onSelect={() => setDialog({row, action: 'details'})}
                          >
                            {t('menu.details')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={row.status !== 'ACTIVE'}
                            onSelect={() => setDialog({row, action: 'trial'})}
                          >
                            {t('menu.trial')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={row.status !== 'ACTIVE'}
                            onSelect={() => setDialog({row, action: 'end'})}
                          >
                            {t('menu.end')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDialog({row, action: 'revoke'})}
                          >
                            {t('menu.revoke')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDialog({row, action: 'ban'})}
                          >
                            {row.banned ? t('menu.unban') : t('menu.ban')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-crit"
                            onSelect={() => setDialog({row, action: 'delete'})}
                          >
                            {t('menu.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-muted">
                {users.isLoading ? t('common:state.loading') : t('users.empty')}
              </Td>
            </Tr>
          )}
        </TBody>
      </Table>
      {users.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button
            size="sm"
            loading={users.isFetchingNextPage}
            onClick={() => void users.fetchNextPage()}
          >
            {t('common:actions.loadMore')}
          </Button>
        </div>
      )}
      {dialog && (
        <ActionDialog
          row={dialog.row}
          action={dialog.action}
          overview={overview}
          onClose={() => setDialog(null)}
        />
      )}
    </Panel>
  );
}
