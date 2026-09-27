/**
 * @fileoverview /ended: static "trial ended" page (效果图 c4, 前端详细设计
 * 6.3.6). No API calls, no token; language from `?lang=` or the local
 * preference. The data went to a ZIP whose download link was e-mailed
 * once; the account and e-mail are deleted.
 */

import {Link} from '@tanstack/react-router';
import {ShieldCheck} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Button} from '../../shared/ui/button';
import {DataRow, PublicShell} from './public_shell';

/** Privacy notice (static document served with the SPA). */
export const PRIVACY_URL = '/privacy.html';

/** Trial-ended page. */
export function EndedPage() {
  const {t} = useTranslation('auth');
  return (
    <PublicShell
      left={
        <>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-xs text-warn">
            <span aria-hidden>●</span>
            {t('ended.tag')}
          </span>
          <h1 className="text-4xl leading-tight font-bold tracking-tight text-text lg:text-5xl">
            {t('ended.title')}
            <br />
            <span className="text-gradient">{t('ended.titleAccent')}</span>
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            {t('ended.body')}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="primary" size="lg">
              <Link to="/signup">{t('ended.signupAgain')}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href={PRIVACY_URL}>{t('ended.privacy')}</a>
            </Button>
          </div>
        </>
      }
      right={
        <>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-text">
            <ShieldCheck className="size-5 text-cyan" aria-hidden />
            {t('ended.whereTitle')}
          </h2>
          <ul>
            <DataRow
              tone="good"
              tag={t('ended.archived')}
              text={t('ended.archivedText')}
              value={t('ended.archivedValue')}
            />
            <DataRow
              tone="cyan"
              tag={t('ended.sent')}
              text={t('ended.sentText')}
              value={t('ended.sentValue')}
            />
            <DataRow
              tone="crit"
              tag={t('ended.deleted')}
              text={t('ended.deletedText')}
              value={t('ended.deletedValue')}
            />
            <DataRow
              tone="neutral"
              tag={t('ended.expiring')}
              text={t('ended.expiringText')}
              value={t('ended.expiringValue')}
            />
          </ul>
          <p className="mt-4 text-xs text-dim">{t('ended.notReceived')}</p>
        </>
      }
    />
  );
}
