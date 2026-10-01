/**
 * @fileoverview /login: e-mail + Turnstile → 6-digit code. The admin then
 * needs a passkey ({@link AdminPasskeyStep}). Returns to `?next=` after
 * signing in. Visitors without an account (e.g. a first visit redirected
 * here by the guard) get a prominent sign-up entry under the form.
 */

import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  applySession,
  type PasskeyStep,
  type SessionOutcome,
} from '../../features/identity/api';
import {
  AuthCardHeader,
  AuthShell,
} from '../../features/identity/components/auth_shell';
import {EmailCodeFlow} from '../../features/identity/components/email_code_flow';
import {Button} from '../../shared/ui/button';
import {AdminPasskeyStep} from './admin_passkey_step';

/** Only same-app paths are accepted as `next` (no open redirect). */
export function safeNext(next: unknown, fallback: string): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/^\/(login|signup|ended)\b/.test(next)) return fallback;
  return next;
}

/** Login page. */
export function LoginPage() {
  const {t} = useTranslation('auth');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({strict: false}) as {next?: string};
  const [passkey, setPasskey] = useState<PasskeyStep | null>(null);

  const done = async (fallback: string) => {
    await navigate({to: safeNext(search.next, fallback)});
  };

  const onOutcome = async (o: SessionOutcome) => {
    if (o.kind === 'passkeyRequired') {
      setPasskey(o);
      return;
    }
    applySession(o, qc);
    await done('/cockpit');
  };

  return (
    <AuthShell
      headline={t('login.headline')}
      headlineAccent={t('login.headlineAccent')}
      note={t('login.note')}
    >
      <AuthCardHeader title={passkey ? t('admin.title') : t('login.title')} />
      {passkey ? (
        <AdminPasskeyStep
          step={passkey}
          onDone={() => void done('/admin')}
          onRestart={() => setPasskey(null)}
        />
      ) : (
        <>
          <EmailCodeFlow
            purpose="login"
            totalSteps={2}
            submitLabel={t('login.submit')}
            onOutcome={onOutcome}
          />
          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-6">
            <p className="text-center text-sm text-muted">
              {t('login.noAccount')}
            </p>
            <Button asChild size="lg">
              <Link to="/signup">{t('login.signupCta')}</Link>
            </Button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
