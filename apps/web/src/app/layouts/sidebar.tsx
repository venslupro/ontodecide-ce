/**
 * @fileoverview 216 px sidebar: brand, grouped navigation (运营 / 构建 /
 * 我的; admin: 平台), and the trial or admin card at the bottom.
 */

import {Link} from '@tanstack/react-router';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {Brand} from '../../shared/ui/brand';
import {visibleGroups} from '../nav';
import {SidebarCard} from './trial_card';

/** Sidebar. */
export function Sidebar() {
  const {t} = useTranslation('common');
  const isAdmin = useSession(s => s.role === 'admin');
  return (
    <aside className="sticky top-0 flex h-screen w-[216px] shrink-0 flex-col border-r border-line bg-bg/70 backdrop-blur-sm">
      <div className="px-4 pt-4 pb-5">
        <Brand
          edition={isAdmin ? t('brand.editionAdmin') : t('brand.edition')}
        />
      </div>
      <nav
        aria-label={t('nav.label')}
        className="min-h-0 flex-1 overflow-y-auto px-2.5"
      >
        {visibleGroups(isAdmin).map(g => (
          <div key={g.key} className="mb-4">
            <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-dim">
              {t(`nav.group.${g.key}`)}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.items.map(item => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex h-9 items-center gap-2.5 rounded-[10px] border border-transparent px-2.5 text-sm whitespace-nowrap text-muted transition-colors hover:bg-panel-2 hover:text-text"
                    activeProps={{
                      className:
                        '!border-cyan/30 !bg-[linear-gradient(90deg,color-mix(in_srgb,var(--cyan)_16%,transparent),transparent)] !text-text shadow-[inset_2px_0_0_var(--cyan)]',
                      'aria-current': 'page',
                    }}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="p-3">
        <SidebarCard />
      </div>
    </aside>
  );
}
