/**
 * @fileoverview /account "账户与数据" (效果图 c3, 前端详细设计 6.11 账户与数据):
 * trial lifecycle timeline (T, +48 h, +72 h, 7-day link, deletion), the
 * account (the only Owner, e-mail code login, sessions n / 3, language,
 * time zone), the archive preview with "export now" (GET /me/export →
 * `ontodecide-export-<date>.jsonl`), and the danger zone to end the trial
 * early (POST /me/codes → code → POST /me/trial/termination → /ended).
 *
 * Admin variant: "平台管理员 · 不过期 · 不可删除" instead of the timeline,
 * no archive preview and no danger zone; export is kept.
 */

import {
  ARCHIVE_FILES,
  LIFECYCLE,
  type ArchiveFile,
} from '@ontodecide/shared-kernel';
import {useQueryClient} from '@tanstack/react-query';
import {Download, ShieldCheck, Trash2} from 'lucide-react';
import {useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {useMe} from '../../entities/session/api';
import {notifyTrialEnded} from '../../entities/session/lifecycle';
import {useSession, type Me} from '../../entities/session/store';
import {
  exportWorkspace,
  patchMe,
  sendTerminateCode,
  terminateTrial,
} from '../../features/identity/api';
import {LangSwitch} from '../../features/identity/components/lang_switch';
import {isApiError} from '../../shared/api/errors';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {qk} from '../../shared/api/query_keys';
import {cn} from '../../shared/lib/cn';
import {isoDay, saveBlob} from '../../shared/lib/download';
import {fmt, shortTid} from '../../shared/lib/format';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {PageHeader} from '../../shared/ui/page_header';
import {OTP_LENGTH, OtpInput} from '../../shared/ui/otp_input';
import {PageLoader} from '../../shared/ui/skeleton';
import {toast} from '../../shared/ui/toast';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A lifecycle milestone. */
export interface Milestone {
  key: 'signup' | 'reminder' | 'expiry' | 'link' | 'purge';
  at: number | null;
  state: 'done' | 'current' | 'todo';
}

/** Builds the 5-node lifecycle timeline (current = first not yet passed). */
export function lifecycleMilestones(
  verifiedAt: number,
  trialExpiresAt: number,
  now: number,
): Milestone[] {
  const raw: Omit<Milestone, 'state'>[] = [
    {key: 'signup', at: verifiedAt},
    {key: 'reminder', at: verifiedAt + LIFECYCLE.reminderAfterHours * HOUR},
    {key: 'expiry', at: trialExpiresAt},
    {key: 'link', at: null},
    {key: 'purge', at: trialExpiresAt + LIFECYCLE.archiveDays * DAY},
  ];
  let currentSet = false;
  return raw.map(m => {
    const passed =
      m.key === 'link'
        ? now >= trialExpiresAt + LIFECYCLE.archiveDays * DAY
        : (m.at ?? 0) <= now;
    if (passed) return {...m, state: 'done'};
    if (!currentSet) {
      currentSet = true;
      return {...m, state: 'current'};
    }
    return {...m, state: 'todo'};
  });
}

const FILE_LABEL: Record<ArchiveFile, string> = {
  'ontology.json': 'ontology',
  'objects.jsonl': 'objects',
  'links.jsonl': 'links',
  'imports.json': 'imports',
  'situation.json': 'situation',
  'decisions.json': 'decisions',
  'audit.jsonl': 'audit',
};

const FILE_ORDER: readonly ArchiveFile[] = [
  'ontology.json',
  'objects.jsonl',
  'links.jsonl',
  'imports.json',
  'situation.json',
  'decisions.json',
  'audit.jsonl',
].filter(f =>
  (ARCHIVE_FILES as readonly string[]).includes(f),
) as ArchiveFile[];

function Timeline({me}: {me: Me}) {
  const {t} = useTranslation('account');
  const texp = Date.parse(me.workspace.trialExpiresAt ?? '');
  const ver = Date.parse(me.workspace.verifiedAt);
  const skew = useSession(s => s.clockSkewMs);
  const items = lifecycleMilestones(ver, texp, Date.now() + skew);
  return (
    <Panel
      title={t('lifecycle.title')}
      actions={
        <span className="text-xs text-muted">{t('lifecycle.tzNote')}</span>
      }
    >
      <ol
        className="relative grid grid-cols-5 pt-2 pb-1"
        aria-label={t('lifecycle.title')}
      >
        {items.map((m, i) => (
          <li
            key={m.key}
            className="relative flex flex-col items-center gap-2 text-center"
            aria-current={m.state === 'current' ? 'step' : undefined}
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-[15px] right-1/2 h-0.5 w-full',
                  m.state === 'done' || m.state === 'current'
                    ? 'bg-cyan'
                    : 'bg-line-2',
                )}
                style={{zIndex: 0}}
              />
            )}
            <span
              className={cn(
                'relative z-[1] flex size-8 items-center justify-center rounded-full text-xs font-semibold',
                m.state === 'done' && 'bg-cyan text-on-accent',
                m.state === 'current' &&
                  'border-2 border-cyan bg-bg-2 text-cyan shadow-[0_0_14px_color-mix(in_srgb,var(--cyan)_55%,transparent)]',
                m.state === 'todo' && 'border border-line-2 bg-bg-2 text-muted',
              )}
            >
              {i + 1}
            </span>
            <span className="text-sm font-medium text-text">
              {t(`lifecycle.${m.key}`)}
            </span>
            <span className="num text-xs text-muted">
              {m.at === null
                ? t('lifecycle.linkDays', {days: LIFECYCLE.archiveDays})
                : fmt.shortDateTime(m.at, me.timeZone)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function AdminLifecycle() {
  const {t} = useTranslation('account');
  return (
    <section className="admin-card flex items-center gap-4 px-5 py-4">
      <ShieldCheck className="size-7 text-violet" aria-hidden />
      <div>
        <p className="text-base font-semibold text-text">{t('admin.badge')}</p>
        <p className="text-sm text-muted">{t('admin.note')}</p>
      </div>
    </section>
  );
}

function ExportButton() {
  const {t} = useTranslation('account');
  const [busy, setBusy] = useState(false);
  const [bytes, setBytes] = useState(0);
  const run = async () => {
    setBusy(true);
    setBytes(0);
    try {
      const blob = await exportWorkspace(setBytes);
      saveBlob(blob, `ontodecide-export-${isoDay()}.jsonl`);
      toast.success(t('export.done'));
    } catch (e) {
      toast.error(t('export.failed'), errorMessage(e, t), {
        traceId: errorTraceId(e),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="primary" loading={busy} onClick={() => void run()}>
      {!busy && <Download aria-hidden />}
      {busy && bytes > 0 ? fmt.bytes(bytes) : t('export.button')}
    </Button>
  );
}

function timeZones(current: string): string[] {
  const intl = Intl as unknown as {supportedValuesOf?: (k: string) => string[]};
  const list = intl.supportedValuesOf?.('timeZone') ?? [];
  return list.includes(current) ? list : [current, ...list];
}

function AccountCard({me, admin}: {me: Me; admin: boolean}) {
  const {t} = useTranslation('account');
  const qc = useQueryClient();
  const [tz, setTz] = useState(me.timeZone);
  const saveTz = async (value: string) => {
    setTz(value);
    try {
      const next = await patchMe({timeZone: value});
      useSession.getState().setMe({...me, ...next});
      qc.setQueryData(qk.me(), {...me, ...next});
    } catch (e) {
      setTz(me.timeZone);
      toast.error(errorMessage(e, t), undefined, {
        traceId: errorTraceId(e),
      });
    }
  };
  const rows: [string, ReactNode][] = [
    [t('account.email'), <span className="text-text">{me.email}</span>],
    [
      t('account.role'),
      <Badge tone={admin ? 'violet' : 'cyan'}>
        ● {admin ? t('account.roleAdmin') : t('account.roleOwner')}
      </Badge>,
    ],
    [
      t('account.method'),
      <span className="text-text">
        {admin ? t('account.methodAdmin') : t('account.methodOwner')}
      </span>,
    ],
    [
      t('account.sessions'),
      <span className="num text-text">
        {me.sessions.used} / {me.sessions.limit}
      </span>,
    ],
    [t('account.language'), <LangSwitch />],
    [
      t('account.timeZone'),
      <select
        aria-label={t('account.timeZone')}
        className="h-8 max-w-64 rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-2 text-sm text-text"
        value={tz}
        onChange={e => void saveTz(e.target.value)}
      >
        {timeZones(me.timeZone).map(z => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>,
    ],
  ];
  return (
    <Panel title={t('account.title')}>
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[140px_1fr] items-center gap-4 px-2 py-3"
          >
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="text-sm">{v}</dd>
          </div>
        ))}
      </dl>
      {admin && (
        <div className="mt-4 flex items-center gap-3">
          <ExportButton />
          <span className="text-xs text-muted">{t('export.adminNote')}</span>
        </div>
      )}
    </Panel>
  );
}

function ArchivePreview() {
  const {t} = useTranslation('account');
  return (
    <Panel
      title={t('archive.title')}
      actions={
        <span className="text-xs text-muted">{t('archive.oneZip')}</span>
      }
    >
      <ul className="divide-y divide-line">
        {FILE_ORDER.map(f => (
          <li key={f} className="flex items-center gap-3 py-2.5">
            <Badge tone="good">● {t('archive.tag')}</Badge>
            <span className="flex-1 text-sm text-text">
              {t(`archive.file.${FILE_LABEL[f]}`)}
            </span>
            <code className="font-mono text-xs text-muted">{f}</code>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ExportButton />
        <span className="text-xs text-muted">{t('archive.notArchived')}</span>
      </div>
      <p className="mt-2 text-xs text-dim">{t('archive.onceNote')}</p>
    </Panel>
  );
}

function TerminateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
}) {
  const {t} = useTranslation('account');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendTerminateCode();
      setSent(true);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (value = code) => {
    if (value.length !== OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await terminateTrial(value);
      onOpenChange(false);
      notifyTrialEnded();
    } catch (e) {
      setError(
        isApiError(e, 'CODE_INVALID') && typeof e.extras.left === 'number'
          ? t('common:errors.CODE_INVALID', {left: e.extras.left})
          : errorMessage(e, t),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) {
          setSent(false);
          setCode('');
          setError(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent
        title={t('danger.dialogTitle')}
        description={t('danger.dialogBody')}
        footer={
          sent ? (
            <Button
              variant="danger"
              loading={busy}
              disabled={code.length !== OTP_LENGTH}
              onClick={() => void confirm()}
            >
              {t('danger.confirm')}
            </Button>
          ) : (
            <Button variant="danger" loading={busy} onClick={() => void send()}>
              {t('danger.sendCode')}
            </Button>
          )
        }
      >
        {sent ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('danger.codeSent')}</p>
            <OtpInput
              label={t('danger.codeLabel')}
              value={code}
              onChange={setCode}
              onComplete={v => void confirm(v)}
              invalid={!!error}
              autoFocus
            />
          </div>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>{t('danger.point1')}</li>
            <li>{t('danger.point2')}</li>
            <li>{t('danger.point3')}</li>
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-crit">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DangerZone() {
  const {t} = useTranslation('account');
  const [open, setOpen] = useState(false);
  return (
    <section className="danger-zone flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Trash2 className="size-4 text-crit" aria-hidden />
          {t('danger.title')}
        </h2>
        <p className="mt-2 text-sm text-muted">{t('danger.body')}</p>
      </div>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t('danger.button')}
      </Button>
      <TerminateDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}

/** Account & data page. */
export function AccountPage() {
  const {t} = useTranslation('account');
  const q = useMe();
  const role = useSession(s => s.role);
  const me = q.data ?? useSession.getState().me;
  if (!me) return <PageLoader />;
  const admin = role === 'admin' || me.role === 'admin';
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={
          admin
            ? t('breadcrumbAdmin', {tid: shortTid(me.workspace.tenantId)})
            : t('breadcrumb', {tid: shortTid(me.workspace.tenantId)})
        }
        title={t('title')}
      />
      {admin ? <AdminLifecycle /> : <Timeline me={me} />}
      <div
        className={cn(
          'grid gap-4',
          admin ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2',
        )}
      >
        <AccountCard me={me} admin={admin} />
        {!admin && <ArchivePreview />}
      </div>
      {!admin && <DangerZone />}
    </div>
  );
}
