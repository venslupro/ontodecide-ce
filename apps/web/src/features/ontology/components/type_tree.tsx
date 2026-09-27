/**
 * @fileoverview Workbench navigation tree: object types (with their
 * property count), link types and action types, each with an "add" button.
 */

import type {DefKind, OntologyDef} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Box, GitBranch, Plus, Zap} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {Button} from '../../../shared/ui/button';

/** Current selection (`id` null = a new, unsaved definition). */
export interface DefSelection {
  kind: DefKind;
  id: string | null;
}

/** Tree props. */
export interface TypeTreeProps {
  ontology: OntologyDef;
  locale: string;
  selected: DefSelection | null;
  onSelect(sel: DefSelection): void;
}

const ICONS: Record<DefKind, ReactNode> = {
  'object-types': <Box aria-hidden />,
  'link-types': <GitBranch aria-hidden />,
  'action-types': <Zap aria-hidden />,
};

/** The tree. */
export function TypeTree({
  ontology,
  locale,
  selected,
  onSelect,
}: TypeTreeProps) {
  const {t} = useTranslation('ontology');
  const sections: {
    kind: DefKind;
    items: {id: string; label: string; meta: string}[];
  }[] = [
    {
      kind: 'object-types',
      items: ontology.objectTypes.map(o => ({
        id: o.apiName,
        label: resolveText(o.displayName, locale, o.apiName),
        meta: t('tree.propCount', {count: o.properties.length}),
      })),
    },
    {
      kind: 'link-types',
      items: ontology.linkTypes.map(l => ({
        id: l.apiName,
        label: resolveText(l.displayName, locale, l.apiName),
        meta: `${l.from} → ${l.to}`,
      })),
    },
    {
      kind: 'action-types',
      items: ontology.actionTypes.map(a => ({
        id: a.apiName,
        label: resolveText(a.displayName, locale, a.apiName),
        meta: a.targetType,
      })),
    },
  ];
  return (
    <nav aria-label={t('tree.label')} className="flex flex-col gap-4">
      {sections.map(s => (
        <div key={s.kind} className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted [&_svg]:size-3.5">
            {ICONS[s.kind]}
            <h2 id={`tree-${s.kind}`}>{t(`kind.${s.kind}`)}</h2>
            <span className="num text-dim">{s.items.length}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={t(`tree.add.${s.kind}`)}
              onClick={() => onSelect({kind: s.kind, id: null})}
            >
              <Plus aria-hidden />
            </Button>
          </div>
          <ul aria-labelledby={`tree-${s.kind}`} className="flex flex-col">
            {s.items.map(item => {
              const active =
                selected?.kind === s.kind && selected.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect({kind: s.kind, id: item.id})}
                    className={cn(
                      'flex w-full items-baseline gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm',
                      active
                        ? 'bg-cyan/12 text-cyan'
                        : 'text-text hover:bg-panel-2',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-dim">
                      {item.meta}
                    </span>
                  </button>
                </li>
              );
            })}
            {selected?.kind === s.kind && selected.id === null && (
              <li>
                <span className="flex rounded-[8px] bg-cyan/12 px-2 py-1.5 text-sm text-cyan">
                  {t(`tree.new.${s.kind}`)}
                </span>
              </li>
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}
