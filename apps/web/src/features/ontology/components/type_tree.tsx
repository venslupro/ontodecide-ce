/**
 * @fileoverview Workbench type tree: object types (with property counts),
 * link types, action types and simulation KPIs; add / remove items and
 * select one for editing.
 */

import type {SchemaDef} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Box, Gauge, Link2, Plus, Settings2, Trash2, Zap} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {typeColor} from '../../../shared/graph/limit';
import {cn} from '../../../shared/lib/cn';
import {Button} from '../../../shared/ui/button';
import type {SectionKind, Selection} from '../model';

/** Type tree props. */
export interface TypeTreeProps {
  def: SchemaDef;
  selection: Selection;
  onSelect(sel: Selection): void;
  onAdd(kind: SectionKind): void;
  onRemove(kind: SectionKind, index: number): void;
  readOnly?: boolean;
}

interface Item {
  key: string;
  index: number;
  label: string;
  apiName: string;
  meta?: string;
  color?: string;
}

/** The left-hand tree. */
export function TypeTree({
  def,
  selection,
  onSelect,
  onAdd,
  onRemove,
  readOnly,
}: TypeTreeProps) {
  const {t, i18n} = useTranslation('ontology');
  const lang = i18n.language;
  const order = def.objectTypes.map(o => o.apiName);
  const label = (text: Parameters<typeof resolveText>[0], fb: string) =>
    resolveText(text, lang, fb) || fb;

  const sections: {
    kind: SectionKind;
    title: string;
    icon: ReactNode;
    items: Item[];
  }[] = [
    {
      kind: 'object',
      title: t('tree.objectTypes'),
      icon: <Box aria-hidden />,
      items: def.objectTypes.map((o, i) => ({
        key: `o${i}`,
        index: i,
        label: label(o.displayName, o.apiName),
        apiName: o.apiName,
        meta: t('tree.propCount', {count: o.properties.length}),
        color: typeColor(o.apiName, order),
      })),
    },
    {
      kind: 'link',
      title: t('tree.linkTypes'),
      icon: <Link2 aria-hidden />,
      items: def.linkTypes.map((l, i) => ({
        key: `l${i}`,
        index: i,
        label: label(l.displayName, l.apiName),
        apiName: l.apiName,
        meta: `${l.from} → ${l.to}`,
      })),
    },
    {
      kind: 'action',
      title: t('tree.actionTypes'),
      icon: <Zap aria-hidden />,
      items: def.actionTypes.map((a, i) => ({
        key: `a${i}`,
        index: i,
        label: label(a.displayName, a.apiName),
        apiName: a.apiName,
        meta: a.targetType,
      })),
    },
    {
      kind: 'kpi',
      title: t('tree.kpis'),
      icon: <Gauge aria-hidden />,
      items: (def.simulationKpis ?? []).map((k, i) => ({
        key: `k${i}`,
        index: i,
        label: label(k.displayName, k.apiName),
        apiName: k.apiName,
        meta: `${k.agg}${k.property ? `(${k.property})` : ''}`,
      })),
    },
  ];

  const isSel = (kind: SectionKind | 'schema', index?: number) =>
    selection.kind === kind &&
    (kind === 'schema' || (selection as {index: number}).index === index);

  return (
    <nav aria-label={t('tree.label')} className="flex flex-col gap-3 text-sm">
      <button
        type="button"
        onClick={() => onSelect({kind: 'schema'})}
        aria-current={isSel('schema') ? 'true' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel-2',
          isSel('schema') && 'bg-cyan/10 text-cyan',
        )}
      >
        <Settings2 className="size-4 shrink-0" aria-hidden />
        <span className="truncate font-medium">{t('tree.schemaSettings')}</span>
      </button>
      {sections.map(sec => (
        <section key={sec.kind} aria-labelledby={`tree-${sec.kind}`}>
          <div className="mb-1 flex items-center justify-between gap-2 px-2">
            <h3
              id={`tree-${sec.kind}`}
              className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-muted [&_svg]:size-3.5"
            >
              {sec.icon}
              {sec.title}
              <span className="num text-dim">{sec.items.length}</span>
            </h3>
            {!readOnly && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('tree.add', {section: sec.title})}
                title={t('tree.add', {section: sec.title})}
                onClick={() => onAdd(sec.kind)}
                disabled={sec.kind !== 'object' && def.objectTypes.length === 0}
              >
                <Plus aria-hidden />
              </Button>
            )}
          </div>
          {sec.items.length === 0 ? (
            <p className="px-2 py-1 text-xs text-dim">{t('tree.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sec.items.map(it => {
                const selected = isSel(sec.kind, it.index);
                return (
                  <li key={it.key} className="group relative">
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({kind: sec.kind, index: it.index})
                      }
                      aria-current={selected ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-left hover:bg-panel-2',
                        selected && 'bg-cyan/10 text-cyan ring-1 ring-cyan/30',
                      )}
                    >
                      {it.color && (
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{background: it.color}}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{it.label}</span>
                        <span className="block truncate font-mono text-[11px] text-dim">
                          {it.apiName}
                          {it.meta ? ` · ${it.meta}` : ''}
                        </span>
                      </span>
                    </button>
                    {!readOnly && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="absolute top-1/2 right-1 -translate-y-1/2 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={t('tree.remove', {name: it.label})}
                        title={t('tree.remove', {name: it.label})}
                        onClick={() => onRemove(sec.kind, it.index)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </nav>
  );
}
