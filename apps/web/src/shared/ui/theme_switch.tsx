/**
 * @fileoverview Theme switch (follow system | light | dark): an icon radio
 * group styled like {@link Segmented}, shown next to the language switch
 * on the top bar, the public pages and the account page.
 */

import {Monitor, Moon, Sun, type LucideIcon} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../lib/cn';
import {
  setThemePref,
  THEME_PREFS,
  useThemePref,
  type ThemePref,
} from '../lib/theme';

const ICON: Record<ThemePref, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** Theme radio group. */
export function ThemeSwitch({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  const {t} = useTranslation('common');
  const value = useThemePref();
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      className={cn(
        'inline-flex overflow-hidden rounded-[var(--radius-btn)] border border-line-2 bg-panel-2',
        className,
      )}
    >
      {THEME_PREFS.map(p => {
        const on = p === value;
        const Icon = ICON[p];
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t(`theme.${p}`)}
            title={t(`theme.${p}`)}
            onClick={() => !on && setThemePref(p)}
            className={cn(
              'flex items-center justify-center transition-colors',
              size === 'sm' ? 'h-7 w-8' : 'h-8 w-9',
              on
                ? 'bg-cyan/15 text-text shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--cyan)_45%,transparent)]'
                : 'text-muted hover:text-text',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
