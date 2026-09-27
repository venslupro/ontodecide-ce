/**
 * @fileoverview Layout of the public info pages /ended and
 * /archive-deletions/:token (效果图 c4): brand + language switch on top,
 * explanation on the left, a status card on the right. No app shell, no API
 * calls of its own.
 */

import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {LangSwitch} from '../../features/identity/components/lang_switch';
import {Brand} from '../../shared/ui/brand';

/** Two-column public page. */
export function PublicShell({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  const {t} = useTranslation('common');
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-8 lg:px-24">
        <Brand edition={t('brand.editionShort')} />
        <LangSwitch />
      </header>
      <main className="mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-10 px-6 pb-16 lg:grid-cols-[1fr_minmax(440px,620px)] lg:px-24 lg:pt-8">
        <section className="flex flex-col gap-6">{left}</section>
        <section className="glass shadow-[0_0_60px_color-mix(in_srgb,var(--cyan)_8%,transparent)]">
          <div className="p-8">{right}</div>
        </section>
      </main>
    </div>
  );
}

/** One row of the "where is your data" card. */
export function DataRow({
  tone,
  tag,
  text,
  value,
}: {
  tone: 'good' | 'cyan' | 'crit' | 'neutral';
  tag: string;
  text: string;
  value: string;
}) {
  const color = {
    good: 'border-good/40 bg-good/10 text-good',
    cyan: 'border-cyan/40 bg-cyan/10 text-cyan',
    crit: 'border-crit/40 bg-crit/10 text-crit',
    neutral: 'border-line-2 bg-panel-2 text-muted',
  }[tone];
  return (
    <li className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${color}`}
      >
        <span aria-hidden>●</span>
        {tag}
      </span>
      <span className="min-w-0 flex-1 text-sm text-text">{text}</span>
      <span className="shrink-0 text-sm text-muted">{value}</span>
    </li>
  );
}
