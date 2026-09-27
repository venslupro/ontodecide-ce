/**
 * @fileoverview Top-bar notifications bell (效果图 c2 / c9): unread count of
 * OPEN alerts and pending recommendations, and a dropdown with the latest
 * items linking to the object or the recommendation. "Seen" is local
 * (localStorage per workspace).
 */

import {useNavigate} from '@tanstack/react-router';
import {Bell, Sparkles} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {
  seenId,
  useNotifications,
  type NotificationItem,
} from '../../features/situation/notifications';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {severityLevel} from '../../shared/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown_menu';

const DOT = {
  crit: 'bg-crit',
  warn: 'bg-warn',
  info: 'bg-cyan',
  good: 'bg-good',
} as const;

/** Bell with unread badge and the latest notifications. */
export function NotificationBell() {
  const {t} = useTranslation('common');
  const navigate = useNavigate();
  const scope = useSession(
    s => s.actAs?.tenantId ?? s.me?.workspace.tenantId ?? s.claims?.tid ?? null,
  );
  const {items, unread, seen, markOne, markAll} = useNotifications(scope);

  const open = (n: NotificationItem) => {
    markOne(n);
    if (n.kind === 'recommendation') {
      void navigate({to: '/recommendations/$id', params: {id: n.id}});
    } else if (n.rid) {
      void navigate({to: '/objects/$rid', params: {rid: n.rid}});
    } else {
      void navigate({to: '/cockpit'});
    }
  };

  const badge = unread > 99 ? '99+' : String(unread);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative flex size-10 items-center justify-center rounded-[10px] border border-line-2 bg-panel-2 text-muted hover:text-text"
        aria-label={
          unread
            ? t('notifications.labelUnread', {count: unread})
            : t('notifications.label')
        }
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            data-testid="notification-count"
            className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-crit px-1 text-[10px] font-semibold text-white"
          >
            {badge}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96 max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">
            {t('notifications.title')}
          </span>
          {unread > 0 && (
            <button
              type="button"
              className="text-xs text-cyan hover:underline"
              onClick={e => {
                e.preventDefault();
                markAll();
              }}
            >
              {t('notifications.markAll')}
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-dim">
            {t('notifications.empty')}
          </p>
        ) : (
          items.map(n => {
            const isNew = !seen.includes(seenId(n));
            return (
              <DropdownMenuItem
                key={seenId(n)}
                onSelect={() => open(n)}
                className="items-start gap-2.5 py-2"
              >
                {n.kind === 'alert' ? (
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      DOT[severityLevel(n.severity ?? 'LOW')],
                    )}
                  />
                ) : (
                  <Sparkles
                    aria-hidden
                    className="mt-0.5 !size-3.5 shrink-0 text-violet"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate',
                      isNew ? 'font-medium text-text' : 'text-muted',
                    )}
                  >
                    {n.title}
                  </span>
                  <span className="block text-[11px] text-dim">
                    {n.kind === 'alert'
                      ? t('notifications.alert')
                      : t('notifications.recommendation')}
                    {' · '}
                    {fmt.ago(n.at)}
                  </span>
                </span>
                {isNew && (
                  <span className="sr-only">{t('notifications.new')}</span>
                )}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
