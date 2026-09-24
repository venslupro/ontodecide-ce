/**
 * @fileoverview Evidence chain of a recommendation. Every evidence item is a
 * link to the Object View with `#prop-<prop>`, which scrolls to the property
 * and opens its lineage.
 */

import type {Evidence} from '@ontodecide/decision/contract';
import {parseRid} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {ChevronRight, Database, FileSearch} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {getRenderer} from '../../../entities/renderers/registry';
import {fmt} from '../../../shared/lib/format';
import {EmptyState} from '../../../shared/ui/empty_state';
import {useObjectTitle} from './object_link';

function EvidenceItem({ev, index}: {ev: Evidence; index: number}) {
  const {t} = useTranslation('recommendations');
  const {model} = useUiModel();
  const typeName = parseRid(ev.rid)?.objectType;
  const type = typeName ? model.byName[typeName] : undefined;
  const prop = type?.properties.find(p => p.apiName === ev.prop);
  const title = useObjectTitle(ev.rid);
  const propName = prop?.displayName ?? ev.prop;
  const value = getRenderer(prop?.dataType ?? 'string').text(ev.value, {
    apiName: ev.prop,
    displayName: propName,
    dataType:
      prop?.dataType ?? (typeof ev.value === 'number' ? 'double' : 'string'),
    unit: prop?.unit,
  });
  const pv = ev.provenance;

  return (
    <li>
      <Link
        to="/objects/rid/$rid"
        params={{rid: ev.rid}}
        hash={`prop-${ev.prop}`}
        aria-label={t('evidence.itemAria', {
          n: index + 1,
          object: title,
          property: propName,
          value,
        })}
        className="group flex items-start gap-3 rounded-[10px] border border-line bg-panel-2/60 px-3 py-2.5 transition-colors hover:border-cyan/50 hover:bg-cyan/5 focus-visible:border-cyan"
      >
        <span
          aria-hidden
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-cyan/40 bg-cyan/10 text-[10px] font-semibold text-cyan num"
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-text break-words">{title}</span>
            {type && (
              <span className="text-xs text-dim">{type.displayName}</span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted">{propName}</span>
            <span className="num font-semibold text-text">{value}</span>
          </span>
          {pv && (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-dim">
              <span className="inline-flex items-center gap-1">
                <Database className="size-3" aria-hidden />
                {t('evidence.source', {source: pv.sourceId})}
              </span>
              <span>
                {t('evidence.ingested', {time: fmt.dateTime(pv.ingestedAt)})}
              </span>
              <span className="num">
                {t('evidence.confidence', {value: pv.confidence})}
              </span>
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 self-center text-xs whitespace-nowrap text-dim group-hover:text-cyan">
          {t('evidence.lineage')}
          <ChevronRight className="size-3.5" aria-hidden />
        </span>
      </Link>
    </li>
  );
}

/** Ordered list of evidence items (each a deep link to the property lineage). */
export function EvidenceChain({
  evidence,
  className,
}: {
  evidence: readonly Evidence[];
  className?: string;
}) {
  const {t} = useTranslation('recommendations');
  if (evidence.length === 0) {
    return (
      <EmptyState
        icon={<FileSearch aria-hidden />}
        title={t('evidence.empty')}
        className="py-6"
      />
    );
  }
  return (
    <ol
      className={className ?? 'flex flex-col gap-2'}
      aria-label={t('evidence.title')}
    >
      {evidence.map((ev, i) => (
        <EvidenceItem key={`${ev.rid}:${ev.prop}:${i}`} ev={ev} index={i} />
      ))}
    </ol>
  );
}
