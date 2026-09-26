/**
 * @fileoverview Realtime connection status badge (icon + text + color).
 */

import {Radio, RefreshCw, WifiOff} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../../shared/ui/badge';
import {useRealtimeStatus} from '../stream';

/** Shows the global WebSocket state from {@link useRealtimeStatus}. */
export function RealtimeBadge({className}: {className?: string}) {
  const {t} = useTranslation('cockpit');
  const state = useRealtimeStatus(s => s.state);
  const label = t(`common:realtime.${state}`);
  const tone =
    state === 'open'
      ? 'good'
      : state === 'connecting' ||
          state === 'reconnecting' ||
          state === 'polling'
        ? 'warn'
        : 'neutral';
  const Icon =
    state === 'open'
      ? Radio
      : state === 'connecting' || state === 'reconnecting'
        ? RefreshCw
        : state === 'polling'
          ? RefreshCw
          : WifiOff;
  return (
    <Badge
      tone={tone}
      className={className}
      role="status"
      aria-label={t('realtimeLabel', {state: label})}
    >
      <Icon
        aria-hidden
        className={state === 'open' ? 'animate-pulse' : undefined}
      />
      {label}
    </Badge>
  );
}
