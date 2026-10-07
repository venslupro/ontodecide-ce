/**
 * @fileoverview /admin "平台概览" (效果图 c9, role admin only): KPI cards,
 * today's free-tier usage (Resend included; ≥ 80% amber + text,
 * "80% 自动关闭注册"), sign-up controls (pause / resume, daily and active
 * limits with sliders; If-Match + passkey step-up), recent admin actions,
 * the workspace table, B2 archives, and the tools: blocked domains, audit
 * log (chainOk) and passkeys. Refreshes every 60 s.
 */

import type {
  PlatformOverview,
  PlatformSettings,
} from '@ontodecide/identity/contract';
import {useQueryClient} from '@tanstack/react-query';
import {AlertTriangle, Download, Trash2} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  deleteArchiveAdmin,
  invalidateAdmin,
  patchSettings,
  useAdminArchives,
  useAdminOverview,
  useAdminSettings,
} from '../../features/admin/api';
import {AdminConfirmDialog} from '../../features/admin/components/confirm_dialog';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {cn} from '../../shared/lib/cn';
import {fmt, shortTid} from '../../shared/lib/format';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card, Panel} from '../../shared/ui/card';
import {Input} from '../../shared/ui/input';
import {PageHeader} from '../../shared/ui/page_header';
import {Progress} from '../../shared/ui/progress';
import {Slider} from '../../shared/ui/slider';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';
import {AdminTools} from './admin_tools';
import {downloadArchive, UsersPanel} from './users_panel';

/** Usage ratio at which sign-ups close automatically. */
export const AUTO_CLOSE_RATIO = 0.8;

/** Hard daily cap of Workers AI neurons enforced by the platform. */
export const NEURONS_HARD_CAP = 8000;

function Kpi({
  label,
  used,
  limit,
}: {
  label: string;
  used?: number;
  limit?: number;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="num text-[28px] leading-none font-semibold text-text">
          {used === undefined ? '—' : fmt.number(used)}
        </span>
        <span className="num text-base text-muted">
          / {limit === undefined ? '—' : fmt.number(limit)}
        </span>
      </p>
    </Card>
  );
}

function FreeQuota({ov}: {ov?: PlatformOverview}) {
  const {t} = useTranslation('admin');
  return (
    <Panel
      title={t('quota.title')}
      actions={
        <span className="text-xs text-muted">{t('quota.autoClose')}</span>
      }
    >
      <div className="flex flex-col gap-4">
        {(ov?.freeQuota ?? []).map(q => {
          const ratio = q.limit > 0 ? q.used / q.limit : 0;
          const hot = ratio >= AUTO_CLOSE_RATIO;
          const label = t(`quota.${q.key}`);
          return (
            <div key={q.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-text">{label}</span>
                <span className={cn('num', hot ? 'text-warn' : 'text-text')}>
                  {hot && (
                    <AlertTriangle
                      className="mr-1 inline size-3.5"
                      aria-hidden
                    />
                  )}
                  {fmt.percent(ratio)}
                  {hot && (
                    <span className="ml-1 text-xs">{t('quota.high')}</span>
                  )}
                </span>
              </div>
              <Progress
                value={ratio}
                tone={hot ? 'warn' : 'accent'}
                label={`${label} ${fmt.percent(ratio)}`}
              />
              <span className="num text-xs text-muted">
                {fmt.number(q.used)} / {fmt.number(q.limit)}
                {q.key === 'neurons' &&
                  ` · ${t('quota.hardCap', {cap: fmt.number(NEURONS_HARD_CAP)})}`}
              </span>
            </div>
          );
        })}
        {ov?.analyticsAt && (
          <p className="text-[11px] text-dim">
            {t('quota.analyticsAt', {time: fmt.dateTime(ov.analyticsAt)})}
          </p>
        )}
      </div>
    </Panel>
  );
}

type SettingsPatch = Partial<
  Pick<
    PlatformSettings,
    'signupEnabled' | 'signupDailyLimit' | 'activeWorkspaceLimit'
  >
>;

function LimitEditor({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange(v: number): void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <Input
          type="number"
          min={0}
          max={max}
          inputSize="sm"
          className="w-20 text-right"
          aria-label={label}
          value={value}
          onChange={e =>
            onChange(
              Math.max(
                0,
                Math.min(max, Math.round(Number(e.target.value) || 0)),
              ),
            )
          }
        />
      </div>
      <Slider
        min={0}
        max={max}
        step={1}
        value={[value]}
        thumbLabel={label}
        onValueChange={v => onChange(v[0] ?? 0)}
      />
    </div>
  );
}

function SignupControl({ov}: {ov?: PlatformOverview}) {
  const {t} = useTranslation('admin');
  const qc = useQueryClient();
  const settings = useAdminSettings();
  const [pending, setPending] = useState<SettingsPatch | null>(null);
  const [daily, setDaily] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const s = settings.data;
  const state = ov?.signup.state ?? (s?.signupEnabled ? 'open' : 'paused');
  const tone = state === 'open' ? 'good' : state === 'paused' ? 'warn' : 'crit';
  const editing = daily !== null || active !== null;
  const rows: [string, string][] = s
    ? [
        [
          t('signup.daily'),
          t('cap', {value: s.signupDailyLimit, min: 0, max: 20}),
        ],
        [
          t('signup.active'),
          t('cap', {value: s.activeWorkspaceLimit, min: 0, max: 60}),
        ],
        [t('signup.trial'), t('signup.trialValue', {hours: s.trialHours})],
        [t('signup.archive'), t('signup.archiveValue', {days: s.archiveDays})],
      ]
    : [];

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {t('signup.title')}
          <Badge tone={tone}>● {t(`signup.state.${state}`)}</Badge>
        </span>
      }
      actions={
        s && (
          <>
            <Button
              size="sm"
              onClick={() => {
                setDaily(s.signupDailyLimit);
                setActive(s.activeWorkspaceLimit);
              }}
            >
              {t('signup.editLimits')}
            </Button>
            {s.signupEnabled ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setPending({signupEnabled: false})}
              >
                {t('pauseSignup')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => setPending({signupEnabled: true})}
              >
                {t('resumeSignup')}
              </Button>
            )}
          </>
        )
      }
    >
      <dl className="grid grid-cols-1 gap-x-8 divide-y divide-line md:grid-cols-2 md:divide-y-0">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 border-line py-2.5 md:border-b">
            <dt className="w-32 shrink-0 text-sm text-muted">{k}</dt>
            <dd className="num text-sm text-text">{v}</dd>
          </div>
        ))}
      </dl>
      {s && editing && (
        <div className="mt-4 flex flex-col gap-4 rounded-[10px] border border-line-2 bg-bg-2/50 p-4">
          <LimitEditor
            label={t('signup.daily')}
            value={daily ?? 0}
            max={20}
            onChange={setDaily}
          />
          <LimitEditor
            label={t('signup.active')}
            value={active ?? 0}
            max={60}
            onChange={setActive}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDaily(null);
                setActive(null);
              }}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setPending({
                  signupDailyLimit: daily ?? s.signupDailyLimit,
                  activeWorkspaceLimit: active ?? s.activeWorkspaceLimit,
                })
              }
            >
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      )}
      {s && pending && (
        <AdminConfirmDialog
          open
          onOpenChange={v => !v && setPending(null)}
          highRisk
          title={t('settings.confirmTitle')}
          description={t('settings.confirmBody')}
          confirmLabel={t('settings.confirm')}
          onConfirm={w => patchSettings(pending, s.version, w)}
          onDone={() => {
            setPending(null);
            setDaily(null);
            setActive(null);
            toast.success(t('done'));
            void invalidateAdmin(qc);
          }}
        >
          <ul className="list-disc pl-5 text-sm text-text">
            {pending.signupEnabled !== undefined && (
              <li>
                {pending.signupEnabled ? t('resumeSignup') : t('pauseSignup')}
              </li>
            )}
            {pending.signupDailyLimit !== undefined && (
              <li>
                {t('signup.daily')}: {pending.signupDailyLimit}
              </li>
            )}
            {pending.activeWorkspaceLimit !== undefined && (
              <li>
                {t('signup.active')}: {pending.activeWorkspaceLimit}
              </li>
            )}
          </ul>
        </AdminConfirmDialog>
      )}
    </Panel>
  );
}

function RecentActions({ov}: {ov?: PlatformOverview}) {
  const {t} = useTranslation('admin');
  const tone = {
    modify: 'cyan',
    delete: 'crit',
    enter: 'violet',
    view: 'neutral',
  } as const;
  const list = ov?.recentActions ?? [];
  return (
    <Panel
      title={t('recent.title')}
      actions={
        <span className="text-xs text-muted">{t('recent.audited')}</span>
      }
    >
      {list.length === 0 ? (
        <p className="py-4 text-sm text-muted">{t('recent.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex items-center gap-4 py-2.5">
              <span className="num w-12 shrink-0 text-sm text-muted">
                {fmt.time(a.at)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-text">
                {t(`audit.action.${a.action}`, {defaultValue: a.action})}
                {a.target && (
                  <span className="ml-1.5 font-mono text-xs text-muted">
                    {shortTid(a.target)}
                  </span>
                )}
              </span>
              <Badge tone={tone[a.kind]}>● {t(`recent.kind.${a.kind}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ArchivesPanel() {
  const {t} = useTranslation('admin');
  const qc = useQueryClient();
  const q = useAdminArchives();
  const [del, setDel] = useState<string | null>(null);
  const rows = q.data?.pages.flatMap(p => p.items) ?? [];
  return (
    <Panel
      title={t('archives.title')}
      actions={<span className="text-xs text-muted">{t('archives.hint')}</span>}
    >
      <Table aria-label={t('archives.title')}>
        <THead>
          <Tr>
            <Th>{t('users.id')}</Th>
            <Th>{t('archives.size')}</Th>
            <Th>{t('archives.created')}</Th>
            <Th>{t('archives.expires')}</Th>
            <Th>SHA-256</Th>
            <Th className="text-right">{t('users.actions')}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map(a => (
            <Tr key={a.tenantId}>
              <Td className="font-mono text-xs" title={a.tenantId}>
                {shortTid(a.tenantId)}
              </Td>
              <Td className="num">{fmt.bytes(a.sizeBytes)}</Td>
              <Td className="num">{fmt.dateTime(a.createdAt)}</Td>
              <Td className="num">{fmt.dateTime(a.expiresAt)}</Td>
              <Td className="font-mono text-xs text-muted" title={a.sha256}>
                {a.sha256.slice(0, 12)}…
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void downloadArchive(a.tenantId, e =>
                        toast.error(errorMessage(e, t), undefined, {
                          traceId: errorTraceId(e),
                        }),
                      )
                    }
                  >
                    <Download aria-hidden />
                    {t('users.downloadZip')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setDel(a.tenantId)}
                    aria-label={`${t('archives.delete')} ${a.tenantId}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-6 text-center text-muted">
                {q.isLoading ? t('common:state.loading') : t('archives.empty')}
              </Td>
            </Tr>
          )}
        </TBody>
      </Table>
      {q.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button
            size="sm"
            loading={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {t('common:actions.loadMore')}
          </Button>
        </div>
      )}
      {del && (
        <AdminConfirmDialog
          open
          onOpenChange={v => !v && setDel(null)}
          highRisk
          danger
          target={{tenantId: del, email: null}}
          title={t('archives.deleteTitle')}
          description={t('archives.deleteBody')}
          confirmLabel={t('archives.delete')}
          onConfirm={w => deleteArchiveAdmin(del, w)}
          onDone={() => {
            toast.success(t('done'));
            void invalidateAdmin(qc);
          }}
        />
      )}
    </Panel>
  );
}

/**
 * Operational warnings of the overview: account analytics not configured,
 * archive sagas stuck ≥ 24 h, B2 signing key due for rotation.
 */
export function PlatformWarnings({ov}: {ov?: PlatformOverview}) {
  const {t} = useTranslation('admin');
  if (!ov) return null;
  const chips: string[] = [];
  if (ov.analyticsConfigured === false) chips.push(t('warn.analytics'));
  if ((ov.stuckArchives ?? 0) > 0)
    chips.push(t('warn.stuckArchives', {count: ov.stuckArchives}));
  if (ov.signKeyRotationDue) chips.push(t('warn.signKey'));
  if (!chips.length) return null;
  return (
    <ul aria-label={t('warn.label')} className="flex flex-wrap gap-2">
      {chips.map(c => (
        <li key={c}>
          <Badge tone="warn">● {c}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Platform admin page. */
export function AdminPage() {
  const {t} = useTranslation('admin');
  const ov = useAdminOverview();
  const o = ov.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={t('breadcrumb')}
        title={t('title')}
        actions={<AdminTools />}
      />
      <PlatformWarnings ov={o} />
      {ov.isError && (
        <p role="alert" className="text-sm text-crit">
          {errorMessage(ov.error, t)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-[14px] xl:grid-cols-4">
        <Kpi
          label={t('kpi.activeTrials')}
          used={o?.activeTrials.used}
          limit={o?.activeTrials.limit}
        />
        <Kpi
          label={t('kpi.signupsToday')}
          used={o?.signupsToday.used}
          limit={o?.signupsToday.limit}
        />
        <Kpi
          label={t('kpi.archives')}
          used={o?.archives.used}
          limit={o?.archives.limit}
        />
        <Kpi
          label={t('kpi.purgeBacklog')}
          used={o?.purgeBacklog.used}
          limit={o?.purgeBacklog.limit}
        />
      </div>
      <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <FreeQuota ov={o} />
        <div className="flex min-w-0 flex-col gap-[14px]">
          <SignupControl ov={o} />
          <RecentActions ov={o} />
        </div>
      </div>
      <UsersPanel overview={o} />
      <ArchivesPanel />
    </div>
  );
}
