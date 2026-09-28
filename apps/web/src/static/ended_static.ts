/**
 * @fileoverview Framework-free /ended page (前端详细设计 表 1: 说明页 JS ≤ 60
 * KB gzip, no app shell). Cloudflare Pages serves `ended.html` for a hard
 * load of `/ended` (e-mail links, reloads), so that first load needs no
 * React, router or API client; in-app navigation keeps using the React
 * route with the same content (`pages/ended/ended_page.tsx`).
 *
 * Static: no API calls, no token. Language from `?lang=`, else the local
 * preference, else the browser; the 中文 | EN switch re-renders in place
 * and remembers the choice.
 */

import {ended as enEnded} from '../locales/en-US/auth.json';
import {brand as enBrand, lang as enLang} from '../locales/en-US/common.json';
import {ended as zhEnded} from '../locales/zh-CN/auth.json';
import {brand as zhBrand, lang as zhLang} from '../locales/zh-CN/common.json';
import {readPrefs, writePrefs} from '../shared/lib/prefs';

/** UI language of the static page. */
export type StaticLang = 'zh-CN' | 'en-US';

/** Privacy notice (static document served with the SPA). */
export const PRIVACY_URL = '/privacy.html';

const TEXT = {
  'zh-CN': {ended: zhEnded, brand: zhBrand, lang: zhLang},
  'en-US': {ended: enEnded, brand: enBrand, lang: enLang},
} as const;

function norm(tag: string | null | undefined): StaticLang | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith('zh')) return 'zh-CN';
  if (t.startsWith('en')) return 'en-US';
  return null;
}

/** Resolves the language: `?lang=` > local preference > navigator > zh-CN. */
export function resolveStaticLang(
  search: string,
  local: string | undefined,
  navigatorLangs: readonly string[],
): StaticLang {
  const q = norm(new URLSearchParams(search).get('lang'));
  if (q) return q;
  const l = norm(local);
  if (l) return l;
  for (const n of navigatorLangs) {
    const v = norm(n);
    if (v) return v;
  }
  return 'zh-CN';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TONE = {
  good: 'border-good/40 bg-good/10 text-good',
  cyan: 'border-cyan/40 bg-cyan/10 text-cyan',
  crit: 'border-crit/40 bg-crit/10 text-crit',
  neutral: 'border-line-2 bg-panel-2 text-muted',
} as const;

function row(
  tone: keyof typeof TONE,
  tag: string,
  text: string,
  value: string,
): string {
  return `<li class="flex items-center gap-3 border-b border-line py-3 last:border-b-0"><span class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${TONE[tone]}"><span aria-hidden="true">●</span>${esc(tag)}</span><span class="min-w-0 flex-1 text-sm text-text">${esc(text)}</span><span class="shrink-0 text-sm text-muted">${esc(value)}</span></li>`;
}

const BTN =
  'inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-btn)] px-5 text-base font-medium';

/** Page markup for a language (pure; unit-tested). */
export function endedHtml(lang: StaticLang): string {
  const {ended: e, brand, lang: l} = TEXT[lang];
  const seg = (value: StaticLang, label: string, aria?: string) => {
    const on = value === lang;
    return `<button type="button" role="radio" data-lang="${value}" aria-checked="${on}"${aria ? ` aria-label="${aria}"` : ''} class="h-8 px-3.5 text-sm whitespace-nowrap ${on ? 'bg-cyan/15 font-medium text-text' : 'text-muted hover:text-text'}">${label}</button>`;
  };
  return `<div class="min-h-screen">
<header class="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-8 lg:px-24">
<div class="flex items-center gap-2.5"><span aria-hidden="true" class="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,var(--cyan),var(--blue)_50%,var(--violet))]"><span class="size-[55%] rounded-[6px] border-[3px] border-bg bg-bg"></span></span><div class="leading-tight"><div class="text-[17px] font-semibold tracking-tight text-text">OntoDecide</div><div class="text-[11px] text-muted">${esc(brand.editionShort)}</div></div></div>
<div role="radiogroup" aria-label="${esc(l.label)}" class="inline-flex overflow-hidden rounded-[var(--radius-btn)] border border-line-2 bg-panel-2">${seg('zh-CN', '中文')}${seg('en-US', 'EN', 'English')}</div>
</header>
<main class="mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-10 px-6 pb-16 lg:grid-cols-[1fr_minmax(440px,620px)] lg:px-24 lg:pt-8">
<section class="flex flex-col gap-6">
<span class="inline-flex w-fit items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-xs text-warn"><span aria-hidden="true">●</span>${esc(e.tag)}</span>
<h1 class="text-4xl leading-tight font-bold tracking-tight text-text lg:text-5xl">${esc(e.title)}<br><span class="text-gradient">${esc(e.titleAccent)}</span></h1>
<p class="max-w-2xl text-base leading-relaxed text-muted">${esc(e.body)}</p>
<div class="flex flex-wrap gap-3"><a href="/signup" class="${BTN} bg-[linear-gradient(90deg,var(--cyan),var(--blue))] text-on-accent">${esc(e.signupAgain)}</a><a href="${PRIVACY_URL}" class="${BTN} border border-line-2 text-text hover:bg-panel-2">${esc(e.privacy)}</a></div>
</section>
<section class="glass"><div class="p-8">
<h2 class="mb-3 text-base font-semibold text-text">${esc(e.whereTitle)}</h2>
<ul>${row('good', e.archived, e.archivedText, e.archivedValue)}${row('cyan', e.sent, e.sentText, e.sentValue)}${row('crit', e.deleted, e.deletedText, e.deletedValue)}${row('neutral', e.expiring, e.expiringText, e.expiringValue)}</ul>
<p class="mt-4 text-xs text-dim">${esc(e.notReceived)}</p>
</div></section>
</main>
</div>`;
}

/** Renders into `root` and wires the language switch. */
export function renderEnded(root: HTMLElement, lang: StaticLang): void {
  root.innerHTML = endedHtml(lang);
  document.documentElement.lang = lang;
  document.title = `OntoDecide CE · ${TEXT[lang].ended.tag}`;
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    b.addEventListener('click', () => {
      const next = b.dataset.lang as StaticLang;
      if (next === lang) return;
      writePrefs({locale: next});
      renderEnded(root, next);
    });
  }
}

/** Entry used by `ended.html`. */
export function bootEnded(): void {
  const root = document.getElementById('root');
  if (!root) return;
  renderEnded(
    root,
    resolveStaticLang(location.search, readPrefs().locale, navigator.languages),
  );
}
