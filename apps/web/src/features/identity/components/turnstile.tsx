/**
 * @fileoverview Cloudflare Turnstile (managed mode) for sign-up and login.
 * The only third-party script (`challenges.cloudflare.com`, allowed by the
 * CSP `script-src` / `frame-src`). Site key from `VITE_TURNSTILE_SITE_KEY`;
 * in development the always-passing test key is used.
 */

import {CheckCircle2, Loader2, ShieldAlert} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';

/** Turnstile's always-passing test site key. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback(token: string): void;
      'expired-callback'(): void;
      'error-callback'(): void;
      language?: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      theme?: 'dark' | 'light' | 'auto';
    },
  ): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** The configured site key. */
export function turnstileSiteKey(): string {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (key) return key;
  return import.meta.env.PROD ? '' : TURNSTILE_TEST_SITE_KEY;
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('turnstile'));
    s.onerror = () => {
      loading = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Turnstile widget with a status row ("人机验证已通过"). */
export function Turnstile({
  onToken,
  resetKey,
  className,
}: {
  /** New token, or null when it expired / failed. */
  onToken(token: string | null): void;
  /** Changing it renders a fresh widget (tokens are single-use). */
  resetKey?: unknown;
  className?: string;
}) {
  const {t, i18n} = useTranslation('auth');
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let id: string | undefined;
    let api: TurnstileApi | undefined;
    let cancelled = false;
    setStatus('loading');
    cb.current(null);
    const sitekey = turnstileSiteKey();
    if (!sitekey) {
      setStatus('error');
      return undefined;
    }
    loadTurnstile()
      .then(ts => {
        if (cancelled || !box.current) return;
        api = ts;
        id = ts.render(box.current, {
          sitekey,
          theme: 'dark',
          appearance: 'interaction-only',
          language: i18n.language === 'en-US' ? 'en' : 'zh-cn',
          callback: token => {
            setStatus('ok');
            cb.current(token);
          },
          'expired-callback': () => {
            setStatus('loading');
            cb.current(null);
          },
          'error-callback': () => {
            setStatus('error');
            cb.current(null);
          },
        });
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
      if (id && api) {
        try {
          api.remove(id);
        } catch {
          // Widget already gone.
        }
      }
    };
    // Language is read once per widget.
  }, [resetKey, i18n.language]);

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-[10px] border border-line-2 bg-bg-2/60 px-4 py-3',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5 text-sm" aria-live="polite">
          {status === 'ok' ? (
            <CheckCircle2 className="size-5 text-good" aria-hidden />
          ) : status === 'error' ? (
            <ShieldAlert className="size-5 text-crit" aria-hidden />
          ) : (
            <Loader2 className="size-5 animate-spin text-cyan" aria-hidden />
          )}
          {t(`turnstile.${status}`)}
        </span>
        <span className="text-xs text-dim">Cloudflare Turnstile</span>
      </div>
      <div ref={box} />
    </div>
  );
}
