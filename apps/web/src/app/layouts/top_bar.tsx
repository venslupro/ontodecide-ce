/**
 * @fileoverview 56 px top bar: sidebar toggle, global search, quota bar,
 * notification center, language switch (中文 | EN), theme toggle, user menu.
 */

import {Link, useNavigate} from '@tanstack/react-router';
import {useQueryClient} from '@tanstack/react-query';
import {
  Bell,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  UserRound,
  Info,
  Monitor,
} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {resolveTheme, useSession} from '../../entities/session/store';
import {logout} from '../../features/identity/api';
import {useOverview} from '../../features/situation/api';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import type {Lang} from '../../shared/lib/i18n';
import {SeverityBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown_menu';
import {Popover, PopoverContent, PopoverTrigger} from '../../shared/ui/popover';
import {Tooltip} from '../../shared/ui/tooltip';
import {switchLanguage} from '../lang';
import {GlobalSearch} from './global_search';
import {QuotaBar} from './quota_bar';

/** Language switch 中文 | EN. */
export function LanguageSwitch({className}: {className?: string}) {
  const {i18n, t} = useTranslation('common');
  const qc = useQueryClient();
  const langs: {lang: Lang; label: string}[] = [
    {lang: 'zh-CN', label: '中文'},
    {lang: 'en-US', label: 'EN'},
  ];
  return (
    <div
      role="group"
      aria-label={t('topbar.language')}
      className={cn('flex rounded-[8px] border border-line-2 p-0.5', className)}
    >
      {langs.map(l => (
        <button
          key={l.lang}
          type="button"
          lang={l.lang}
          aria-pressed={i18n.language === l.lang}
          onClick={() => void switchLanguage(l.lang, qc)}
          className={cn(
            'rounded-[6px] px-2 py-0.5 text-xs font-medium transition-colors',
            i18n.language === l.lang
              ? 'bg-cyan/15 text-cyan'
              : 'text-muted hover:text-text',
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Theme toggle cycling dark → light → system. */
export function ThemeToggle() {
  const {t} = useTranslation('common');
  const theme = useSession(s => s.theme);
  const setTheme = useSession(s => s.setTheme);
  const next =
    theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const Icon =
    theme === 'system' ? Monitor : resolveTheme(theme) === 'dark' ? Moon : Sun;
  return (
    <Tooltip content={t(`theme.${theme}`)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('topbar.theme', {theme: t(`theme.${theme}`)})}
        onClick={() => setTheme(next)}
      >
        <Icon aria-hidden />
      </Button>
    </Tooltip>
  );
}

function NotificationCenter() {
  const {t} = useTranslation('common');
  const {data} = useOverview();
  const open = (data?.alerts ?? []).filter(a => a.status === 'OPEN');
  const recs = data?.recommendations ?? [];
  const count = open.length + recs.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('topbar.notifications', {count})}
          className="relative"
        >
          <Bell aria-hidden />
          {count > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[10px] leading-4 font-semibold text-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-line px-3 py-2 text-xs font-semibold text-muted">
          {t('topbar.notificationsTitle')}
        </div>
        <ul className="max-h-80 overflow-auto p-1">
          {count === 0 && (
            <li className="px-3 py-6 text-center text-xs text-dim">
              {t('topbar.noNotifications')}
            </li>
          )}
          {open.slice(0, 8).map(a => (
            <li key={a.id}>
              <Link
                to={a.rid ? '/objects/rid/$rid' : '/cockpit'}
                params={a.rid ? {rid: a.rid} : undefined}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-panel-2"
              >
                <SeverityBadge severity={a.severity} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{a.title}</span>
                  <span className="text-[11px] text-dim">
                    {fmt.ago(a.raisedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {recs.slice(0, 5).map(r => (
            <li key={r.id}>
              <Link
                to="/recommendations/$id"
                params={{id: r.id}}
                className="block rounded-md px-2 py-1.5 hover:bg-panel-2"
              >
                <span className="block truncate text-sm">{r.summary}</span>
                <span className="text-[11px] text-dim">
                  {t('topbar.pendingRec')} · {fmt.ago(r.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const {t} = useTranslation('common');
  const user = useSession(s => s.user);
  const navigate = useNavigate();
  const [about, setAbout] = useState(false);
  if (!user) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="gap-2 px-2"
            aria-label={t('topbar.userMenu')}
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--cyan),var(--violet))] text-xs font-semibold text-on-accent">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden max-w-28 truncate text-sm text-text xl:inline">
              {user.name}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <span className="block text-sm text-text">{user.name}</span>
            <span className="block text-xs text-dim">{user.email}</span>
            <span className="mt-1 block text-xs text-cyan">
              {t(`roles.${user.role}`)}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAbout(true)}>
            <Info aria-hidden />
            {t('topbar.about')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void logout().finally(() =>
                navigate({
                  to: '/login',
                  search: {redirect: undefined, lang: undefined},
                }),
              );
            }}
          >
            <LogOut aria-hidden />
            {t('topbar.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={about} onOpenChange={setAbout}>
        <DialogContent title={t('topbar.about')} size="sm">
          <div className="flex items-center gap-3">
            <UserRound className="size-8 text-cyan" aria-hidden />
            <div>
              <p className="font-semibold text-text">OntoDecide CE</p>
              <p className="text-xs text-muted">
                {t('topbar.version')}:{' '}
                <span className="font-mono">{__APP_VERSION__}</span>
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The top bar. */
export function TopBar() {
  const {t} = useTranslation('common');
  const collapsed = useSession(s => s.sidebarCollapsed);
  const toggle = useSession(s => s.toggleSidebar);
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={collapsed ? t('topbar.expandNav') : t('topbar.collapseNav')}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden />
        ) : (
          <PanelLeftClose aria-hidden />
        )}
      </Button>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1.5">
        <QuotaBar />
        <NotificationCenter />
        <LanguageSwitch />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
