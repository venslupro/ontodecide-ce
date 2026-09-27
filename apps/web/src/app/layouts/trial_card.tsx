/**
 * @fileoverview Sidebar bottom card: owner trial countdown (remaining days
 * and hours, cyan → amber bar, "到期后下载链接发送至邮箱") or the admin
 * card "平台管理员 · 不过期 · 不可删除".
 */

import {Clock, ShieldCheck} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {useTrialCountdown} from '../../entities/workspace/countdown';
import {fmt} from '../../shared/lib/format';

/** Owner trial card. */
export function TrialCard() {
  const {t} = useTranslation('common');
  const c = useTrialCountdown();
  if (!c.active) return null;
  return (
    <section className="trial-card px-4 py-3.5" aria-label={t('trial.left')}>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Clock className="size-3.5 text-cyan" aria-hidden />
        {t('trial.left')}
      </p>
      <p
        className="num mt-2 text-[22px] leading-none font-bold text-text"
        aria-live="off"
      >
        {fmt.remaining(c.remainingMs)}
      </p>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-2"
        role="progressbar"
        aria-label={t('trial.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(c.elapsed * 100)}
      >
        <div
          className="bar-trial h-full rounded-full"
          style={{width: `${Math.max(2, (1 - c.elapsed) * 100)}%`}}
        />
      </div>
      <p className="mt-2.5 text-[11px] text-muted">{t('trial.linkNote')}</p>
    </section>
  );
}

/** Admin card. */
export function AdminCard() {
  const {t} = useTranslation('common');
  return (
    <section className="admin-card px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <ShieldCheck className="size-3.5 text-violet" aria-hidden />
        {t('role.admin')}
      </p>
      <p className="mt-2 text-[18px] leading-tight font-bold text-text">
        {t('adminCard.title')}
      </p>
      <p className="mt-2 text-[11px] text-muted">{t('adminCard.note')}</p>
    </section>
  );
}

/** The card matching the role. */
export function SidebarCard() {
  const isAdmin = useSession(s => s.role === 'admin');
  return isAdmin ? <AdminCard /> : <TrialCard />;
}
