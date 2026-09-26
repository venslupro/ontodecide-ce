/**
 * @fileoverview Degraded-state cards: one per dependency reported by
 * `/admin/usage` (`false` = healthy, `true` = degraded, a string = running
 * on the named fallback), always with icon + text and an explanation.
 */

import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  HeartPulse,
  Server,
} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../shared/lib/cn';
import {Panel} from '../../shared/ui/card';
import {EmptyState} from '../../shared/ui/empty_state';

const ICONS: Record<string, ReactNode> = {
  neo4j: <Database aria-hidden />,
  llm: <Cpu aria-hidden />,
};

const KNOWN = new Set(['neo4j', 'llm', 'realtime', 'kv', 'queues']);

/** Degraded states panel. */
export function DegradedPanel({
  degraded,
}: {
  degraded: Record<string, boolean | string> | undefined;
}) {
  const {t} = useTranslation('admin');
  const entries = Object.entries(degraded ?? {});
  const degradedCount = entries.filter(([, v]) => v !== false).length;
  return (
    <Panel
      title={t('health.degradedTitle')}
      subtitle={
        entries.length
          ? degradedCount
            ? t('health.degradedCount', {count: degradedCount})
            : t('health.allHealthy')
          : undefined
      }
      icon={<HeartPulse aria-hidden />}
    >
      {entries.length === 0 ? (
        <EmptyState title={t('health.noDegraded')} />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {entries.map(([key, value]) => {
            const ok = value === false;
            const name = KNOWN.has(key) ? t(`health.deps.${key}.name`) : key;
            const explanation = ok
              ? t('health.okExplanation')
              : KNOWN.has(key)
                ? typeof value === 'string'
                  ? t(`health.deps.${key}.fallback`, {value})
                  : t(`health.deps.${key}.degraded`)
                : typeof value === 'string'
                  ? t('health.genericFallback', {value})
                  : t('health.genericDegraded');
            return (
              <li
                key={key}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3',
                  ok ? 'border-line bg-panel-2/40' : 'border-warn/40 bg-warn/5',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 text-dim [&_svg]:size-5',
                    !ok && 'text-warn',
                  )}
                >
                  {ICONS[key] ?? <Server aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-text">{name}</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs font-medium',
                        ok ? 'text-good' : 'text-warn',
                      )}
                    >
                      {ok ? (
                        <CheckCircle2 className="size-3.5" aria-hidden />
                      ) : (
                        <AlertTriangle className="size-3.5" aria-hidden />
                      )}
                      {ok ? t('health.statusOk') : t('health.statusDegraded')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{explanation}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
