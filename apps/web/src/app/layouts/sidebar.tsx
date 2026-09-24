/**
 * @fileoverview 216 px navigation sidebar, collapsible to a 64 px icon bar.
 * Items the user's role cannot access are hidden.
 */

import {hasRole} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {cn} from '../../shared/lib/cn';
import {Tooltip} from '../../shared/ui/tooltip';
import {NAV_ITEMS} from '../nav';

/** Brand mark. */
export function BrandMark({className}: {className?: string}) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="od-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cyan)" />
          <stop offset="1" stopColor="var(--violet)" />
        </linearGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="18"
        fill="none"
        stroke="url(#od-brand)"
        strokeWidth="5"
      />
      <circle cx="32" cy="32" r="6" fill="var(--cyan)" />
      <circle cx="52" cy="14" r="4.5" fill="var(--blue)" />
      <path d="M46 19l-7 7" stroke="var(--blue)" strokeWidth="3" />
    </svg>
  );
}

/** Sidebar navigation. */
export function Sidebar() {
  const {t} = useTranslation('common');
  const role = useSession(s => s.user?.role);
  const collapsed = useSession(s => s.sidebarCollapsed);
  const items = NAV_ITEMS.filter(i => role && hasRole([role], i.minRole));
  const groups = ['monitor', 'decide', 'data', 'admin'] as const;
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-bg-2/70 backdrop-blur-md transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-16' : 'w-[216px]',
      )}
      aria-label={t('nav.label')}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2.5 border-b border-line',
          collapsed ? 'justify-center' : 'px-4',
        )}
      >
        <BrandMark className="size-7 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="text-gradient text-sm font-bold tracking-wide">
              OntoDecide
            </p>
            <p className="text-[10px] tracking-widest text-dim uppercase">
              {t('brand.tagline')}
            </p>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map(g => {
          const list = items.filter(i => i.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="mb-3">
              {!collapsed && (
                <p className="px-2 pb-1 text-[10px] font-semibold tracking-wider text-dim uppercase">
                  {t(`nav.groups.${g}`)}
                </p>
              )}
              <ul className="space-y-0.5">
                {list.map(item => {
                  const Icon = item.icon;
                  const link = (
                    <Link
                      to={item.to}
                      activeOptions={{exact: false}}
                      className={cn(
                        'group relative flex h-9 items-center gap-2.5 rounded-[8px] text-sm whitespace-nowrap text-muted transition-colors hover:bg-panel-2 hover:text-text',
                        collapsed ? 'justify-center' : 'px-2.5',
                      )}
                      activeProps={{
                        className:
                          '!text-cyan bg-cyan/10 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-cyan',
                        'aria-current': 'page',
                      }}
                      aria-label={collapsed ? t(item.labelKey) : undefined}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed && <span>{t(item.labelKey)}</span>}
                    </Link>
                  );
                  return (
                    <li key={item.to}>
                      {collapsed ? (
                        <Tooltip content={t(item.labelKey)} side="right">
                          {link}
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      {!collapsed && (
        <p className="border-t border-line px-4 py-2 font-mono text-[10px] text-dim">
          v{__APP_VERSION__}
        </p>
      )}
    </aside>
  );
}
