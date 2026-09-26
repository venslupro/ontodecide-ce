/**
 * @fileoverview Runtime language switching: no reload, `<html lang>`,
 * local + account preference, and re-fetch of text-bearing queries only.
 */

import type {QueryClient} from '@tanstack/react-query';
import {useSession} from '../entities/session/store';
import {api} from '../shared/api/client';
import {i18n, type Lang} from '../shared/lib/i18n';
import {writePrefs} from '../shared/lib/prefs';

/** Switches the UI language. */
export async function switchLanguage(
  lang: Lang,
  qc?: QueryClient,
): Promise<void> {
  if (i18n.language === lang) return;
  await i18n.changeLanguage(lang);
  writePrefs({locale: lang});
  // Only queries that carry server-side text (AI summaries, error details)
  // are re-fetched with the new Accept-Language; data is not re-downloaded.
  void qc?.invalidateQueries({queryKey: ['decision']});
  const s = useSession.getState();
  if (s.status === 'authenticated' && s.user && s.user.locale !== lang) {
    s.setUser({...s.user, locale: lang});
    void api.patch('/me', {locale: lang}).catch(() => {});
  }
}
