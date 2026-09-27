/**
 * @fileoverview 受影响对象: objects most affected by the latest simulation,
 * sorted by impact (orange single-hue bars), each opening its Object View.
 */

import type {ImpactedObject} from '@ontodecide/situation/contract';
import {Link} from '@tanstack/react-router';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {fmt} from '../../../shared/lib/format';

/** Impacted objects list. */
export function ImpactedObjects({items}: {items: readonly ImpactedObject[]}) {
  const {t} = useTranslation('cockpit');
  const {model} = useUiModel();
  const sorted = [...items]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);
  const max = Math.max(0.0001, ...sorted.map(i => Math.abs(i.delta)));
  if (!sorted.length)
    return (
      <p className="py-6 text-center text-sm text-dim">{t('impacted.none')}</p>
    );
  return (
    <ul className="flex flex-col">
      {sorted.map(i => (
        <li key={i.rid} className="border-b border-line last:border-b-0">
          <Link
            to="/objects/$rid"
            params={{rid: i.rid}}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 py-2.5 hover:bg-panel-2/60"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-text">
                {i.title}
              </span>
              <span className="block text-xs text-dim">
                {model.byName[i.type]?.displayName ?? i.type} ·{' '}
                {t('impacted.hop', {n: i.hop})}
              </span>
            </span>
            <span
              aria-hidden
              className="h-1.5 overflow-hidden rounded-full bg-line-2"
            >
              <span
                className="block h-full rounded-full bg-orange"
                style={{width: `${(Math.abs(i.delta) / max) * 100}%`}}
              />
            </span>
            <span className="num text-right text-sm text-orange">
              {fmt.signedPercent(i.delta, 0)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
