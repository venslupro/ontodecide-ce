/**
 * @fileoverview E-mail + Turnstile → 6-digit code, shared by /signup and
 * /login (前端详细设计 6.11 注册与登录).
 *
 * - The code request carries the UI locale (the e-mail uses it) and always
 *   gets 202, so the UI never reveals whether an account exists.
 * - SIGNUP_CLOSED stays on the e-mail step with "今日名额已满".
 * - CODE_INVALID marks the boxes and shows the attempts left; after 5
 *   failures a new code is required.
 * - "Resend" is enabled 60 s after each send (seconds shown); Turnstile
 *   tokens are single-use, so the widget is reset after every send.
 */

import {Mail} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {isApiError} from '../../../shared/api/errors';
import {errorMessage} from '../../../shared/api/error_message';
import {useCountdown} from '../../../shared/lib/hooks';
import {normalizeLang} from '../../../shared/lib/i18n';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Field, Input} from '../../../shared/ui/input';
import {OTP_LENGTH, OtpInput} from '../../../shared/ui/otp_input';
import {
  createSession,
  sendCode,
  type CodePurpose,
  type SessionOutcome,
} from '../api';
import {StepBar} from './auth_shell';
import {Turnstile} from './turnstile';

/** Resend interval (s). */
export const RESEND_SECONDS = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Props of {@link EmailCodeFlow}. */
export interface EmailCodeFlowProps {
  purpose: CodePurpose;
  /** Handles the verified outcome (session or passkey step). */
  onOutcome(outcome: SessionOutcome, email: string): Promise<void> | void;
  /** Total steps shown in the step bar. */
  totalSteps: number;
  /** Primary button on the code step. */
  submitLabel: string;
}

/** Two-step e-mail code form. */
export function EmailCodeFlow({
  purpose,
  onOutcome,
  totalSteps,
  submitLabel,
}: EmailCodeFlowProps) {
  const {t, i18n} = useTranslation('auth');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [needNewCode, setNeedNewCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const resendIn = useCountdown(resendAt);

  const request = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await sendCode({
        email: email.trim().toLowerCase(),
        purpose,
        turnstileToken: token,
        locale: normalizeLang(i18n.language) ?? 'zh-CN',
      });
      setStep('code');
      setCode('');
      setCodeInvalid(false);
      setNeedNewCode(false);
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
    } catch (e) {
      setError(
        isApiError(e, 'SIGNUP_CLOSED')
          ? t('signup.closed')
          : errorMessage(e, t),
      );
    } finally {
      setToken(null);
      setWidgetKey(k => k + 1);
      setBusy(false);
    }
  };

  const onSubmitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError(t('email.invalid'));
      return;
    }
    void request();
  };

  const verify = async (value = code) => {
    if (value.length !== OTP_LENGTH || busy || needNewCode) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await createSession({
        email: email.trim().toLowerCase(),
        code: value,
        purpose,
      });
      await onOutcome(outcome, email.trim().toLowerCase());
    } catch (e) {
      if (isApiError(e, 'CODE_INVALID')) {
        const left =
          typeof e.extras.left === 'number' ? e.extras.left : undefined;
        setCodeInvalid(true);
        if (left === 0) {
          setNeedNewCode(true);
          setError(t('code.exhausted'));
        } else {
          setError(
            left === undefined
              ? t('code.invalid')
              : t('common:errors.CODE_INVALID', {left}),
          );
        }
      } else if (isApiError(e, 'SIGNUP_CLOSED')) {
        setError(t('signup.closed'));
      } else {
        setError(errorMessage(e, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const stepNo = step === 'email' ? 1 : 2;
  return (
    <div>
      <StepBar
        step={stepNo}
        total={totalSteps}
        caption={t('step.caption', {
          step: stepNo,
          total: totalSteps,
          name: t(step === 'email' ? 'step.email' : 'step.code'),
        })}
      />
      {step === 'email' ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={onSubmitEmail}
          noValidate
        >
          <Field label={t('email.label')} htmlFor="auth-email">
            <div className="relative">
              <Mail
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                className="h-11 pl-9 text-base"
                placeholder={t('email.placeholder')}
                value={email}
                aria-invalid={!!error || undefined}
                onChange={e => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </div>
          </Field>
          <Turnstile onToken={setToken} resetKey={widgetKey} />
          {error && (
            <p role="alert" className="text-sm text-crit">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!token || !email}
          >
            {t('email.send')}
          </Button>
          <p className="text-xs leading-relaxed text-dim">{t('privacyNote')}</p>
        </form>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={e => {
            e.preventDefault();
            void verify();
          }}
          noValidate
        >
          <Field label={t('email.label')}>
            <div className="flex h-11 items-center gap-2.5 rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-3 text-base">
              <Mail className="size-4 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{email}</span>
              <Badge tone="good">● {t('email.sent')}</Badge>
            </div>
          </Field>
          <div className="flex flex-col gap-2">
            <span id="otp-label" className="text-xs font-medium text-muted">
              {t('code.label')}
            </span>
            <OtpInput
              label={t('code.label')}
              boxLabel={i => t('code.box', {n: i})}
              value={code}
              invalid={codeInvalid}
              disabled={needNewCode}
              autoFocus
              describedBy={error ? 'otp-error' : undefined}
              onChange={v => {
                setCode(v);
                setCodeInvalid(false);
                if (!needNewCode) setError(null);
              }}
              onComplete={v => void verify(v)}
            />
          </div>
          <Turnstile onToken={setToken} resetKey={widgetKey} />
          {error && (
            <p id="otp-error" role="alert" className="text-sm text-crit">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            disabled={code.length !== OTP_LENGTH || needNewCode}
          >
            {submitLabel}
          </Button>
          <p className="text-xs leading-relaxed text-dim">
            {t('code.notReceived')}{' '}
            {resendIn > 0 ? (
              <span className="num">
                {t('code.resendIn', {seconds: resendIn})}
              </span>
            ) : (
              <button
                type="button"
                className="text-cyan underline-offset-4 hover:underline disabled:opacity-50"
                disabled={!token || busy}
                onClick={() => void request()}
              >
                {t('code.resend')}
              </button>
            )}{' '}
            <button
              type="button"
              className="text-muted underline-offset-4 hover:text-text hover:underline"
              onClick={() => {
                setStep('email');
                setError(null);
              }}
            >
              {t('email.change')}
            </button>
          </p>
          <p className="text-xs leading-relaxed text-dim">{t('privacyNote')}</p>
        </form>
      )}
    </div>
  );
}
