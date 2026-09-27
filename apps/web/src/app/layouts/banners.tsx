/**
 * @fileoverview Banners.
 *
 * - {@link ActAsBanner}: purple 40 px admin-view banner under the top bar,
 *   not dismissible, with "退出".
 * - {@link ExpiryBanner}: amber trial-expiry banner (≤ 24 h left) with the
 *   expiry time in the account time zone and "立即导出"; exported for the
 *   cockpit (agent B puts it at the top of the page).
 * - {@link GlobalBanners}: network offline, realtime down (polling), admin
 *   session ending (≤ 10 min of the 8 h).
 */

import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {Clock, CloudOff, Download, RadioTower, ShieldCheck} from 'lucide-react';
import {useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {notifyAuthFailed} from '../../entities/session/lifecycle';
import {useSession} from '../../entities/session/store';
import {useTrialCountdown} from '../../entities/workspace/countdown';
import {exitActAs} from '../../features/admin/act_as';
import {exportWorkspace} from '../../features/identity/api';
import {errorMessage} from '../../shared/api/error_message';
import {useRemaining} from '../../shared/lib/countdown';
import {isoDay, saveBlob} from '../../shared/lib/download';
import {fmt, shortTid} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
import {Button} from '../../shared/ui/button';
import {toast} from '../../shared/ui/toast';
import {useRealtimeStatus} from '../../shared/ws/stream';

/** Admin view banner. */
export function ActAsBanner() {
  const {t} = useTranslation('admin');
  const actAs = useSession(s => s.actAs);
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (!actAs) return null;
  return (
    <div
      role="status"
      className="actas-banner flex h-10 shrink-0 items-center gap-2.5 px-5 text-sm text-text"
    >
      <ShieldCheck className="size-4 shrink-0 text-violet" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {t('actAsBanner', {
          tid: shortTid(actAs.tenantId),
          email: actAs.email ?? t('users.deleted'),
        })}
        <span className="text-muted"> · {t('actAsAudited')}</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="border-violet/60"
        onClick={() => {
          exitActAs(qc);
          void navigate({to: '/admin'});
        }}
      >
        {t('exit')}
      </Button>
    </div>
  );
}

/** Amber expiry banner (renders nothing unless ≤ 24 h left). */
export function ExpiryBanner({className}: {className?: string}) {
  const {t} = useTranslation('common');
  const c = useTrialCountdown();
  const [busy, setBusy] = useState(false);
  if (!c.active || !c.soon || c.expiresAt === null) return null;
  const run = async () => {
    setBusy(true);
    try {
      saveBlob(await exportWorkspace(), `ontodecide-export-${isoDay()}.jsonl`);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="status"
      className={`expiry-banner flex flex-wrap items-center gap-3 px-4 py-3 ${className ?? ''}`}
    >
      <Clock className="size-5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-text">
          {t('expiry.title', {
            time: fmt.dateTimeTz(c.expiresAt, c.timeZone),
            tz: fmt.tzName(c.expiresAt, c.timeZone),
            left: fmt.remaining(c.remainingMs),
          })}
        </p>
        <p className="text-xs text-muted">{t('expiry.body')}</p>
      </div>
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        onClick={() => void run()}
      >
        {!busy && <Download aria-hidden />}
        {t('expiry.export')}
      </Button>
    </div>
  );
}

function Strip({
  tone,
  icon,
  children,
}: {
  tone: 'warn' | 'crit';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={
        tone === 'crit'
          ? 'flex items-center justify-center gap-2 border-b border-crit/40 bg-crit/15 px-4 py-1.5 text-xs text-crit'
          : 'flex items-center justify-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-xs text-warn'
      }
    >
      <span className="[&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  );
}

function AdminSessionStrip() {
  const {t} = useTranslation('common');
  const endsAt = useSession(s => s.adminSessionEndsAt);
  const skew = useSession(s => s.clockSkewMs);
  const left = useRemaining(endsAt ?? null, skew, () => notifyAuthFailed());
  if (!endsAt || left <= 0 || left > 10 * 60_000) return null;
  return (
    <Strip tone="warn" icon={<Clock />}>
      {t('banner.adminSession', {left: fmt.remaining(left)})}
    </Strip>
  );
}

/** Stack of global strips. */
export function GlobalBanners() {
  const {t} = useTranslation('common');
  const online = useOnline();
  const rt = useRealtimeStatus(s => s.state);
  return (
    <>
      {!online && (
        <Strip tone="crit" icon={<CloudOff />}>
          {t('banner.offline')}
        </Strip>
      )}
      {online && rt === 'polling' && (
        <Strip tone="warn" icon={<RadioTower />}>
          {t('banner.realtimeDown')}
        </Strip>
      )}
      <AdminSessionStrip />
    </>
  );
}
