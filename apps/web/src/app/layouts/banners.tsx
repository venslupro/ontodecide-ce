/**
 * @fileoverview Global banners: network offline, realtime disconnected
 * (polling fallback) and quota nearly exhausted.
 */

import {CloudOff, RadioTower, TriangleAlert} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useSession} from '../../entities/session/store';
import {useRealtimeStatus} from '../../features/situation/stream';
import {useOnline} from '../../shared/lib/hooks';
import {maxUsage} from './quota_bar';

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'warn' | 'crit';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={
        tone === 'crit'
          ? 'flex items-center justify-center gap-2 border-b border-crit/40 bg-crit/15 px-4 py-1.5 text-xs text-crit'
          : 'flex items-center justify-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-xs text-warn'
      }
    >
      <span className="[&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  );
}

/** Stack of global banners. */
export function GlobalBanners() {
  const {t} = useTranslation('common');
  const online = useOnline();
  const rt = useRealtimeStatus(s => s.state);
  const usage = useSession(s => s.usage);
  const {ratio} = maxUsage(usage?.ratios);
  return (
    <>
      {!online && (
        <Banner tone="crit" icon={<CloudOff />}>
          {t('banner.offline')}
        </Banner>
      )}
      {online && rt === 'polling' && (
        <Banner tone="warn" icon={<RadioTower />}>
          {t('banner.realtimeDown')}
        </Banner>
      )}
      {ratio >= 0.95 && (
        <Banner tone="crit" icon={<TriangleAlert />}>
          {t('banner.quota')}
        </Banner>
      )}
    </>
  );
}
