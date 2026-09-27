/**
 * @fileoverview /signup (效果图 c1): e-mail + Turnstile → 6-digit code →
 * 3-day trial. After verification the browser time zone is saved with
 * PATCH /me and the user lands on the cockpit.
 */

import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {
  applySession,
  patchMe,
  type SessionOutcome,
} from '../../features/identity/api';
import {
  AuthCardHeader,
  AuthShell,
} from '../../features/identity/components/auth_shell';
import {EmailCodeFlow} from '../../features/identity/components/email_code_flow';
import {qk} from '../../shared/api/query_keys';

/** Browser time zone (Intl), or undefined. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Sign-up page. */
export function SignupPage() {
  const {t} = useTranslation('auth');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const onOutcome = async (o: SessionOutcome) => {
    if (o.kind !== 'session') {
      // The admin e-mail: continue on the login page (passkey required).
      await navigate({to: '/login'});
      return;
    }
    applySession(o, qc);
    const tz = browserTimeZone();
    const me = useSession.getState().me;
    if (tz && me && me.timeZone !== tz) {
      try {
        const next = await patchMe({timeZone: tz});
        useSession.getState().setMe({...me, ...next});
        qc.setQueryData(qk.me(), {...me, ...next});
      } catch {
        // Time zone can be changed later on the account page.
      }
    }
    await navigate({to: '/cockpit'});
  };

  return (
    <AuthShell
      headline={t('signup.headline')}
      headlineAccent={t('signup.headlineAccent')}
      note={t('signup.note')}
    >
      <AuthCardHeader title={t('signup.title')} />
      <EmailCodeFlow
        purpose="signup"
        totalSteps={3}
        submitLabel={t('signup.submit')}
        onOutcome={onOutcome}
      />
      <p className="mt-6 text-center text-sm text-muted">
        {t('signup.haveAccount')}{' '}
        <Link to="/login" className="text-cyan hover:underline">
          {t('login.link')}
        </Link>
      </p>
    </AuthShell>
  );
}
