/**
 * @fileoverview i18next setup: ICU MessageFormat, runtime language switching
 * (no reload), namespaces split by route and lazily loaded, the other
 * language prefetched when idle.
 *
 * Language resolution order: `?lang` > account preference > local
 * preference > navigator.language > zh-CN.
 */

import i18next, {type BackendModule, type i18n as I18n} from 'i18next';
import ICU from 'i18next-icu';
import {initReactI18next} from 'react-i18next';
import {setFormatLocale} from './format';

/** Supported UI languages. */
export const SUPPORTED_LANGS = ['zh-CN', 'en-US'] as const;

/** A supported UI language. */
export type Lang = (typeof SUPPORTED_LANGS)[number];

/** Default language. */
export const DEFAULT_LANG: Lang = 'zh-CN';

/** Translation namespaces (one per route group). */
export const NAMESPACES = [
  'common',
  'cockpit',
  'objects',
  'scenarios',
  'recommendations',
  'sources',
  'ontology',
  'admin',
] as const;

/** A namespace. */
export type Namespace = (typeof NAMESPACES)[number];

/** Normalizes a language tag to a supported language, or null. */
export function normalizeLang(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith('zh')) return 'zh-CN';
  if (t.startsWith('en')) return 'en-US';
  return null;
}

/** Inputs for {@link resolveLanguage}. */
export interface LangSources {
  search?: string;
  account?: string | null;
  local?: string | null;
  navigator?: readonly string[] | string | null;
}

/** Resolves the UI language following the documented priority. */
export function resolveLanguage(src: LangSources): Lang {
  const fromQuery = src.search
    ? normalizeLang(new URLSearchParams(src.search).get('lang'))
    : null;
  if (fromQuery) return fromQuery;
  const fromAccount = normalizeLang(src.account);
  if (fromAccount) return fromAccount;
  const fromLocal = normalizeLang(src.local);
  if (fromLocal) return fromLocal;
  const navs =
    typeof src.navigator === 'string' ? [src.navigator] : (src.navigator ?? []);
  for (const n of navs) {
    const l = normalizeLang(n);
    if (l) return l;
  }
  return DEFAULT_LANG;
}

/** Returns the other supported language. */
export function otherLang(lang: string): Lang {
  return normalizeLang(lang) === 'en-US' ? 'zh-CN' : 'en-US';
}

type Bundle = Record<string, unknown>;

const loaders = import.meta.glob<{default: Bundle}>('../../locales/*/*.json');

const lazyBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(lng, ns, cb) {
    const load = loaders[`../../locales/${lng}/${ns}.json`];
    if (!load) {
      cb(null, {});
      return;
    }
    load()
      .then(m => cb(null, m.default))
      .catch((e: unknown) =>
        cb(e instanceof Error ? e.message : String(e), false),
      );
  },
};

function applyLang(lng: string): void {
  setFormatLocale(lng);
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}

/** Options for {@link initI18n}. */
export interface InitI18nOptions {
  lng: Lang;
  /** Pre-bundled resources (tests); disables the lazy backend. */
  resources?: Record<string, Record<string, Bundle>>;
  /** Namespaces to load before resolving. */
  ns?: Namespace[];
}

/** Initializes the shared i18next instance. */
export async function initI18n(opts: InitI18nOptions): Promise<I18n> {
  const inst = i18next.use(ICU).use(initReactI18next);
  if (!opts.resources) inst.use(lazyBackend);
  if (!inst.isInitialized) {
    await inst.init({
      lng: opts.lng,
      fallbackLng: DEFAULT_LANG,
      supportedLngs: [...SUPPORTED_LANGS],
      load: 'currentOnly',
      ns: opts.ns ?? ['common'],
      defaultNS: 'common',
      fallbackNS: 'common',
      resources: opts.resources,
      partialBundledLanguages: !opts.resources,
      interpolation: {escapeValue: false},
      returnNull: false,
      react: {useSuspense: !opts.resources},
    });
    inst.on('languageChanged', applyLang);
  } else if (inst.language !== opts.lng) {
    await inst.changeLanguage(opts.lng);
  }
  applyLang(opts.lng);
  if (!opts.resources) schedulePrefetch(inst);
  return inst;
}

function schedulePrefetch(inst: I18n): void {
  const run = () => {
    void inst.loadLanguages(otherLang(inst.language));
  };
  const w = globalThis as {requestIdleCallback?: (cb: () => void) => void};
  if (w.requestIdleCallback) w.requestIdleCallback(run);
  else setTimeout(run, 2000);
}

/** The shared i18next instance. */
export const i18n = i18next;
