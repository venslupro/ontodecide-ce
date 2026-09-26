/**
 * @fileoverview Wizard step 1: choose the connector kind (file, REST pull,
 * webhook) as selectable cards (radio group semantics).
 */

import type {SourceKind} from '@ontodecide/integration/contract';
import {CheckCircle2, FileSpreadsheet, Globe, Webhook} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';

const KINDS: {kind: SourceKind; icon: ReactNode}[] = [
  {kind: 'file', icon: <FileSpreadsheet aria-hidden />},
  {kind: 'rest', icon: <Globe aria-hidden />},
  {kind: 'webhook', icon: <Webhook aria-hidden />},
];

/** Kind selection cards. */
export function SourceKindStep({
  value,
  onChange,
}: {
  value: SourceKind;
  onChange: (k: SourceKind) => void;
}) {
  const {t} = useTranslation('sources');
  return (
    <div
      role="radiogroup"
      aria-label={t('wizard.steps.kind')}
      className="grid grid-cols-1 gap-3.5 md:grid-cols-3"
    >
      {KINDS.map(({kind, icon}) => {
        const active = value === kind;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(kind)}
            className={cn(
              'glass relative flex flex-col items-start gap-2 p-4 text-left transition-[border-color,box-shadow]',
              active
                ? 'border-cyan! shadow-[0_0_0_1px_var(--cyan)]'
                : 'hover:border-cyan/40',
            )}
          >
            {active && (
              <CheckCircle2
                className="absolute top-3 right-3 size-4 text-cyan"
                aria-hidden
              />
            )}
            <span
              className={cn(
                'flex size-10 items-center justify-center rounded-xl border [&_svg]:size-5',
                active
                  ? 'border-cyan/50 bg-cyan/15 text-cyan'
                  : 'border-line-2 bg-panel-2 text-muted',
              )}
            >
              {icon}
            </span>
            <span className="text-sm font-semibold text-text">
              {t(`kinds.${kind}.title`)}
            </span>
            <span className="text-xs text-muted">
              {t(`kinds.${kind}.desc`)}
            </span>
            <span className="mt-auto pt-1 text-[11px] text-dim">
              {t(`kinds.${kind}.meta`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
