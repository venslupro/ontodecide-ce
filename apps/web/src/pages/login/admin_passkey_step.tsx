/**
 * @fileoverview Admin second factor after the e-mail code (前端详细设计
 * 6.3.7, V2.4 #3).
 *
 * - First login (`setupRequired`): one-time setup code from operations →
 *   passkey #1 (`/auth/passkeys/setup-options` + `/auth/passkeys/setup`,
 *   which also issues the admin session) → forced passkey #2 (step-up with
 *   #1, `/admin/passkeys/options` + `POST /admin/passkeys`) → the 10
 *   recovery codes, shown once.
 * - Daily login: passkey assertion (`/auth/passkeys/options` +
 *   `/auth/passkeys/assertion`), or a recovery code instead.
 * - Re-entrant: an admin with fewer than 2 passkeys is sent back to the
 *   second-passkey step on every login.
 * - Without WebAuthn: an explanation, no downgrade.
 */

import {useQueryClient} from '@tanstack/react-query';
import {Fingerprint, KeyRound, ShieldCheck} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {
  addAdminPasskey,
  adminPasskeyOptions,
  applySession,
  passkeyLogin,
  passkeyLoginOptions,
  recoveryLogin,
  setupOptions,
  setupPasskey,
  type PasskeyStep,
} from '../../features/identity/api';
import {RecoveryCodes} from '../../features/identity/components/recovery_codes';
import {isApiError} from '../../shared/api/errors';
import {errorMessage} from '../../shared/api/error_message';
import {
  createPasskey,
  getPasskey,
  isWebAuthnSupported,
  PasskeyError,
  requestStepUp,
} from '../../shared/webauthn';
import {Button} from '../../shared/ui/button';
import {Field, Input} from '../../shared/ui/input';

type Phase = 'setupCode' | 'assert' | 'recovery' | 'second' | 'codes';

/** Admin passkey step. */
export function AdminPasskeyStep({
  step,
  onDone,
  onRestart,
}: {
  step: PasskeyStep;
  onDone(): void;
  onRestart(): void;
}) {
  const {t} = useTranslation('auth');
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>(
    step.setupRequired ? 'setupCode' : 'assert',
  );
  const [setupCode, setSetupCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoStarted = useRef(false);

  const fail = (e: unknown, fallbackKey = 'passkeyFailed') => {
    if (e instanceof PasskeyError) {
      setError(
        e.reason === 'unsupported'
          ? t('passkey.unsupported')
          : t('passkeyFailed'),
      );
    } else if (fallbackKey === 'setupCodeInvalid' && isApiError(e)) {
      setError(t('setupCodeInvalid'));
    } else {
      setError(errorMessage(e, t));
    }
  };

  const afterSession = () => {
    const me = useSession.getState().me;
    if ((me?.passkeys ?? 2) < 2) setPhase('second');
    else onDone();
  };

  const runSetup = async () => {
    setBusy(true);
    setError(null);
    let options: Record<string, unknown>;
    try {
      options = await setupOptions(step.preAuth, setupCode.trim());
    } catch (e) {
      fail(e, 'setupCodeInvalid');
      setBusy(false);
      return;
    }
    try {
      const credential = await createPasskey(options);
      const s = await setupPasskey(step.preAuth, setupCode.trim(), credential);
      applySession(s, qc);
      setPhase('second');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runAssert = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await passkeyLoginOptions(step.preAuth);
      const credential = await getPasskey(options);
      applySession(await passkeyLogin(step.preAuth, credential), qc);
      afterSession();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runRecovery = async () => {
    setBusy(true);
    setError(null);
    try {
      applySession(await recoveryLogin(step.preAuth, recovery.trim()), qc);
      // A replacement passkey must follow when fewer than 2 remain.
      afterSession();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runSecond = async () => {
    setBusy(true);
    setError(null);
    try {
      const stepUp = await requestStepUp();
      const options = await adminPasskeyOptions();
      const credential = await createPasskey(options);
      const r = await addAdminPasskey(credential, stepUp);
      const me = useSession.getState().me;
      if (me) useSession.getState().setMe({...me, passkeys: r.total});
      if (r.recoveryCodes?.length) {
        setCodes(r.recoveryCodes);
        setPhase('codes');
      } else if (r.total >= 2) {
        onDone();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // Daily login: start the passkey prompt right away (once).
  useEffect(() => {
    if (phase === 'assert' && isWebAuthnSupported() && !autoStarted.current) {
      autoStarted.current = true;
      void runAssert();
    }
    // runAssert is stable enough for a one-shot start.
  }, [phase]);

  if (!isWebAuthnSupported() && phase !== 'recovery' && phase !== 'codes') {
    return (
      <div role="alert" className="flex flex-col gap-4">
        <p className="text-sm text-text">{t('passkey.unsupportedTitle')}</p>
        <p className="text-sm text-muted">{t('passkey.unsupported')}</p>
        <Button onClick={onRestart}>{t('passkey.back')}</Button>
      </div>
    );
  }

  const errorView = error && (
    <p role="alert" className="text-sm text-crit">
      {error}
    </p>
  );

  switch (phase) {
    case 'setupCode':
      return (
        <form
          className="flex flex-col gap-5"
          onSubmit={e => {
            e.preventDefault();
            void runSetup();
          }}
        >
          <StepCaption n={1} total={3} text={t('setup.caption1')} />
          <p className="text-sm text-muted">{t('setup.intro')}</p>
          <Field
            label={t('setup.codeLabel')}
            htmlFor="setup-code"
            hint={t('setup.codeHint')}
          >
            <Input
              id="setup-code"
              autoComplete="off"
              className="h-11 font-mono"
              value={setupCode}
              onChange={e => setSetupCode(e.target.value)}
            />
          </Field>
          {errorView}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            disabled={setupCode.trim().length < 8}
          >
            <Fingerprint aria-hidden />
            {t('setup.bindFirst')}
          </Button>
        </form>
      );
    case 'second':
      return (
        <div className="flex flex-col gap-5">
          <StepCaption n={2} total={3} text={t('setup.caption2')} />
          <p className="text-sm text-muted">{t('setup.secondIntro')}</p>
          {errorView}
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            onClick={() => void runSecond()}
          >
            <KeyRound aria-hidden />
            {t('setup.bindSecond')}
          </Button>
        </div>
      );
    case 'codes':
      return (
        <div className="flex flex-col gap-5">
          <StepCaption n={3} total={3} text={t('setup.caption3')} />
          <RecoveryCodes codes={codes} onDone={onDone} />
        </div>
      );
    case 'recovery':
      return (
        <form
          className="flex flex-col gap-5"
          onSubmit={e => {
            e.preventDefault();
            void runRecovery();
          }}
        >
          <p className="text-sm text-muted">{t('recovery.loginIntro')}</p>
          <Field label={t('recovery.codeLabel')} htmlFor="recovery-code">
            <Input
              id="recovery-code"
              autoComplete="off"
              className="h-11 font-mono"
              value={recovery}
              onChange={e => setRecovery(e.target.value)}
            />
          </Field>
          {errorView}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            disabled={recovery.trim().length < 8}
          >
            {t('recovery.submit')}
          </Button>
          <Button variant="ghost" onClick={() => setPhase('assert')}>
            {t('recovery.usePasskey')}
          </Button>
        </form>
      );
    default:
      return (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-[10px] border border-violet/40 bg-violet/10 px-4 py-3 text-sm text-text">
            <ShieldCheck className="size-5 text-violet" aria-hidden />
            {t('passkey.prompt')}
          </div>
          {errorView}
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            onClick={() => void runAssert()}
          >
            <Fingerprint aria-hidden />
            {t('passkey.verify')}
          </Button>
          <button
            type="button"
            className="text-sm text-muted underline-offset-4 hover:text-text hover:underline"
            onClick={() => {
              setError(null);
              setPhase('recovery');
            }}
          >
            {t('recovery.useCode')}
          </button>
        </div>
      );
  }
}

function StepCaption({
  n,
  total,
  text,
}: {
  n: number;
  total: number;
  text: string;
}) {
  const {t} = useTranslation('auth');
  return (
    <p className="text-xs text-muted">
      {t('step.caption', {step: n, total, name: text})}
    </p>
  );
}
