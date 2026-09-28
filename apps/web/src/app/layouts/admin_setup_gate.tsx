/**
 * @fileoverview Admin passkey gate in front of the app shell (前端详细设计
 * 6.3.7; 风险表 "首次登录流程可重入"). Before anything else:
 *
 * - after a recovery-code sign-in (`me.recoveryPending`, or any request
 *   answered 403 RECOVERY_PENDING) the admin binds a new passkey — no
 *   step-up, the recovery session is the proof;
 * - with fewer than 2 passkeys or no recovery codes (or 403
 *   PASSKEY_SETUP_INCOMPLETE) the admin binds another one after a step-up
 *   with an existing passkey;
 * - recovery codes returned by the registration are shown once ("我已保存"
 *   before continuing).
 * After a recovery-session bind the token is refreshed (the session row was
 * upgraded to otp + passkey).
 */

import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {KeyRound, LogOut} from 'lucide-react';
import {useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {adminSetupNeeded, useSession} from '../../entities/session/store';
import {
  addAdminPasskey,
  adminPasskeyOptions,
  logout,
} from '../../features/identity/api';
import {AuthCardHeader} from '../../features/identity/components/auth_shell';
import {RecoveryCodes} from '../../features/identity/components/recovery_codes';
import {errorMessage} from '../../shared/api/error_message';
import {refreshAccessToken} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';
import {
  createPasskey,
  isWebAuthnSupported,
  PasskeyError,
  requestStepUp,
} from '../../shared/webauthn';
import {Brand} from '../../shared/ui/brand';
import {Button} from '../../shared/ui/button';
import {clearClientState} from '../boot';

/** Registers one passkey (step-up unless recovering); returns new codes. */
export async function bindAdminPasskey(
  mode: 'recovery' | 'setup',
): Promise<{total: number; recoveryCodes?: string[]}> {
  const stepUp = mode === 'setup' ? await requestStepUp() : undefined;
  const options = await adminPasskeyOptions();
  const credential = await createPasskey(options);
  return addAdminPasskey(credential, stepUp);
}

/** Renders the passkey setup screen while required, else `children`. */
export function AdminSetupGate({children}: {children: ReactNode}) {
  const needed = useSession(adminSetupNeeded);
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) {
    return (
      <SetupFrame>
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      </SetupFrame>
    );
  }
  if (!needed) return <>{children}</>;
  return (
    <SetupFrame>
      <SetupStep mode={needed} onCodes={setCodes} />
    </SetupFrame>
  );
}

function SetupFrame({children}: {children: ReactNode}) {
  const {t} = useTranslation('auth');
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center gap-6 px-6 py-10"
    >
      <Brand edition={t('common:brand.editionAdmin')} />
      <section className="glass p-8">
        <AuthCardHeader title={t('adminGate.title')} />
        {children}
      </section>
    </main>
  );
}

function SetupStep({
  mode,
  onCodes,
}: {
  mode: 'recovery' | 'setup';
  onCodes(codes: string[]): void;
}) {
  const {t} = useTranslation('auth');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await bindAdminPasskey(mode);
      if (mode === 'recovery') await refreshAccessToken();
      const s = useSession.getState();
      if (s.me) {
        s.setMe({
          ...s.me,
          passkeys: r.total,
          recoveryPending: false,
          ...(r.recoveryCodes
            ? {recoveryCodesLeft: r.recoveryCodes.length}
            : {}),
        });
      }
      s.setAdminGate(undefined);
      if (r.recoveryCodes?.length) onCodes(r.recoveryCodes);
      void qc.invalidateQueries({queryKey: qk.me()});
    } catch (e) {
      setError(
        e instanceof PasskeyError
          ? e.reason === 'unsupported'
            ? t('passkey.unsupported')
            : t('passkeyFailed')
          : errorMessage(e, t),
      );
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } catch {
      // Dropped locally anyway.
    }
    clearClientState(qc);
    await navigate({to: '/login'});
  };

  if (!isWebAuthnSupported()) {
    return (
      <div role="alert" className="flex flex-col gap-4">
        <p className="text-sm text-text">{t('passkey.unsupportedTitle')}</p>
        <p className="text-sm text-muted">{t('passkey.unsupported')}</p>
        <Button variant="ghost" onClick={() => void signOut()}>
          <LogOut aria-hidden />
          {t('common:actions.signOut')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {mode === 'recovery'
          ? t('adminGate.recoveryIntro')
          : t('adminGate.setupIntro')}
      </p>
      {error && (
        <p role="alert" className="text-sm text-crit">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        loading={busy}
        onClick={() => void run()}
      >
        <KeyRound aria-hidden />
        {t('adminGate.bind')}
      </Button>
      <Button variant="ghost" onClick={() => void signOut()}>
        <LogOut aria-hidden />
        {t('common:actions.signOut')}
      </Button>
    </div>
  );
}
