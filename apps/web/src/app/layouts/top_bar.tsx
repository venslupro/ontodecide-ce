/**
 * @fileoverview 56 px top bar: global search, realtime status, 中文 | EN,
 * and the account chip (e-mail + 所有者 Owner / 平台管理员 Admin) with
 * account and sign-out entries.
 */

import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {LogOut, User} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {logout} from '../../features/identity/api';
import {LangSwitch} from '../../features/identity/components/lang_switch';
import {cn} from '../../shared/lib/cn';
import {releaseAll, useRealtimeStatus} from '../../shared/ws/stream';
import type {WsState} from '../../shared/ws/ws_client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown_menu';
import {GlobalSearch} from './global_search';

const DOT: Record<WsState, string> = {
  idle: 'bg-dim',
  connecting: 'bg-warn',
  open: 'bg-good',
  reconnecting: 'bg-warn',
  polling: 'bg-crit',
  paused: 'bg-dim',
  ended: 'bg-dim',
  closed: 'bg-dim',
};

/** Realtime connection badge (text + color). */
export function RealtimeBadge() {
  const {t} = useTranslation('common');
  const state = useRealtimeStatus(s => s.state);
  return (
    <span
      className="flex items-center gap-2 text-sm whitespace-nowrap text-muted"
      role="status"
    >
      <span aria-hidden className={cn('size-2 rounded-full', DOT[state])} />
      {t(`realtime.${state}`)}
    </span>
  );
}

/** Account chip + menu. */
export function AccountChip() {
  const {t} = useTranslation('common');
  const me = useSession(s => s.me);
  const role = useSession(s => s.role);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const email = me?.email ?? '';
  const signOut = async () => {
    try {
      await logout();
    } catch {
      // The session is dropped locally anyway.
    }
    releaseAll();
    useSession.getState().signOut();
    qc.clear();
    await navigate({to: '/login'});
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1 text-left hover:bg-panel-2"
        aria-label={t('account.menu')}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white',
            role === 'admin'
              ? 'bg-[linear-gradient(135deg,var(--blue),var(--violet))]'
              : 'bg-[linear-gradient(135deg,var(--violet),var(--blue))]',
          )}
        >
          {(email[0] ?? '?').toUpperCase()}
        </span>
        <span className="hidden leading-tight md:block">
          <span className="block max-w-56 truncate text-sm text-text">
            {email}
          </span>
          <span className="block text-[11px] text-muted">
            {role === 'admin' ? t('role.adminFull') : t('role.ownerFull')}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/account">
            <User aria-hidden />
            {t('nav.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          {t('actions.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Top bar. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-bg/75 px-5 backdrop-blur-md">
      <GlobalSearch />
      <RealtimeBadge />
      <div className="ml-auto flex items-center gap-3">
        <LangSwitch />
        <AccountChip />
      </div>
    </header>
  );
}
