/**
 * @fileoverview Runtime language switching (前端详细设计 6.11 国际化): no
 * reload, `<html lang>`, local preference, the account preference via
 * PATCH /me when signed in (e-mails then use it), and a re-fetch of only
 * the queries carrying server-generated text (AI rationale).
 */

import type {QueryClient} from '@tanstack/react-query';
import {useSession} from '../../entities/session/store';
import {qk} from '../../shared/api/query_keys';
import {i18n, normalizeLang, type Lang} from '../../shared/lib/i18n';
import {writePrefs} from '../../shared/lib/prefs';
import {patchMe} from './api';

/** Switches the UI language. */
export async function switchLanguage(
  lang: Lang,
  qc?: QueryClient,
): Promise<void> {
  if (normalizeLang(i18n.language) !== lang) {
    await i18n.changeLanguage(lang);
  }
  writePrefs({locale: lang});
  void qc?.invalidateQueries({queryKey: ['decision']});
  const s = useSession.getState();
  if (s.status === 'authenticated' && s.me && s.me.locale !== lang) {
    s.setMe({...s.me, locale: lang});
    qc?.setQueryData(qk.me(), {...s.me, locale: lang});
    try {
      await patchMe({locale: lang});
    } catch {
      // Kept locally; the next change retries.
    }
  }
}
