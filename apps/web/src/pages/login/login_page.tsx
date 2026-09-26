/**
 * @fileoverview Login page: brand hero + email/password form with the
 * 中文 | EN switch; returns to the `redirect` route after signing in.
 */

import {zodResolver} from '@hookform/resolvers/zod';
import {loginInputSchema} from '@ontodecide/identity/contract';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {Brain, Network, ShieldCheck, Sparkles} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import type {z} from 'zod';
import {switchLanguage} from '../../app/lang';
import {LanguageSwitch} from '../../app/layouts/top_bar';
import {BrandMark} from '../../app/layouts/sidebar';
import {useSession} from '../../entities/session/store';
import {login} from '../../features/identity/api';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {useCountdown} from '../../shared/lib/hooks';
import {normalizeLang} from '../../shared/lib/i18n';
import {Button} from '../../shared/ui/button';
import {Field, Input} from '../../shared/ui/input';

type LoginForm = z.infer<typeof loginInputSchema>;

/** Accepts only same-origin relative paths (open-redirect guard). */
export function safeRedirect(target: string | undefined): string {
  if (!target) return '/cockpit';
  try {
    const url = new URL(target, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith('/login'))
      return '/cockpit';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/cockpit';
  }
}

function HeroGraph() {
  // Decorative constellation of linked nodes (brand visual).
  const nodes = [
    [80, 120, 7, 'var(--cyan)'],
    [200, 70, 5, 'var(--blue)'],
    [300, 150, 9, 'var(--violet)'],
    [170, 220, 6, 'var(--cyan)'],
    [390, 90, 5, 'var(--blue)'],
    [420, 230, 7, 'var(--orange)'],
    [270, 290, 5, 'var(--cyan)'],
    [60, 290, 4, 'var(--blue)'],
  ] as const;
  const edges = [
    [0, 1],
    [1, 2],
    [0, 3],
    [3, 2],
    [2, 4],
    [2, 5],
    [3, 6],
    [6, 5],
    [7, 3],
  ];
  return (
    <svg viewBox="0 0 480 340" className="w-full max-w-lg" aria-hidden>
      <defs>
        <radialGradient id="hg" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--cyan)" stopOpacity="0.25" />
          <stop offset="1" stopColor="var(--cyan)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="300" cy="150" r="120" fill="url(#hg)" />
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          stroke="var(--line-2)"
          strokeWidth="1.5"
        />
      ))}
      {nodes.map(([x, y, r, c], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={r * 2.4} fill={c} opacity="0.12" />
          <circle cx={x} cy={y} r={r} fill={c} />
        </g>
      ))}
    </svg>
  );
}

/** Login page. */
export function LoginPage() {
  const {t} = useTranslation('common');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({from: '/login'});
  const status = useSession(s => s.status);
  const [error, setError] = useState<unknown>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const wait = useCountdown(retryUntil);
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: {email: '', password: ''},
  });

  useEffect(() => {
    const l = normalizeLang(search.lang);
    if (l) void switchLanguage(l, qc);
  }, [search.lang, qc]);

  useEffect(() => {
    if (status === 'authenticated')
      void navigate({to: safeRedirect(search.redirect)});
  }, [status, navigate, search.redirect]);

  const onSubmit = form.handleSubmit(async v => {
    setError(null);
    try {
      await login(v.email, v.password);
      void navigate({to: safeRedirect(search.redirect)});
    } catch (e) {
      setError(e);
      if (isApiError(e, 'RATE_LIMITED') && e.retryAfter)
        setRetryUntil(Date.now() + e.retryAfter * 1000);
    }
  });

  const errs = form.formState.errors;
  const features = [
    {icon: <Network aria-hidden />, text: t('login.feature1')},
    {icon: <Brain aria-hidden />, text: t('login.feature2')},
    {icon: <ShieldCheck aria-hidden />, text: t('login.feature3')},
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      <section
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        aria-hidden={false}
      >
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <span className="text-gradient text-lg font-bold tracking-wide">
            OntoDecide CE
          </span>
        </div>
        <div className="max-w-xl">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-cyan/40 bg-cyan/10 px-3 py-1 text-xs text-cyan">
            <Sparkles className="size-3.5" aria-hidden />
            {t('login.badge')}
          </p>
          <h1 className="text-4xl leading-tight font-bold tracking-tight text-text">
            {t('login.heroTitle1')}
            <br />
            <span className="text-gradient">{t('login.heroTitle2')}</span>
          </h1>
          <p className="mt-4 max-w-md text-base text-muted">
            {t('login.heroSubtitle')}
          </p>
          <HeroGraph />
          <ul className="mt-2 grid gap-2">
            {features.map((f, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-sm text-muted [&_svg]:size-4 [&_svg]:text-cyan"
              >
                {f.icon}
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-dim">
          © Persimmon Systems · v{__APP_VERSION__}
        </p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="glass w-full max-w-sm p-7">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2 lg:hidden">
              <BrandMark className="size-7" />
              <span className="text-gradient font-bold">OntoDecide</span>
            </div>
            <LanguageSwitch className="ml-auto" />
          </div>
          <h2 className="text-xl font-semibold text-text">
            {t('login.title')}
          </h2>
          <p className="mt-1 mb-6 text-sm text-muted">{t('login.subtitle')}</p>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Field
              label={t('login.email')}
              htmlFor="email"
              error={errs.email && t('login.emailInvalid')}
              required
            >
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                aria-invalid={!!errs.email || undefined}
                aria-describedby={errs.email ? 'email-error' : undefined}
                {...form.register('email')}
              />
            </Field>
            <Field
              label={t('login.password')}
              htmlFor="password"
              error={errs.password && t('login.passwordRequired')}
              required
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errs.password || undefined}
                aria-describedby={errs.password ? 'password-error' : undefined}
                {...form.register('password')}
              />
            </Field>
            {error !== null && (
              <p
                role="alert"
                className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit"
              >
                {isApiError(error, 'RATE_LIMITED') && wait > 0
                  ? t('errors.RATE_LIMITED', {seconds: wait})
                  : errorMessage(error, t)}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-1 w-full"
              loading={form.formState.isSubmitting}
              disabled={wait > 0}
            >
              {t('login.submit')}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
