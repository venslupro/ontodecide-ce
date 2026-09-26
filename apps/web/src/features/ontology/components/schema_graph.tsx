/**
 * @fileoverview Schema relation graph: object types as nodes (colored by
 * type), link types as labeled edges; clicking a node selects the type.
 */

import type {SchemaDef} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {GraphView} from '../../../shared/graph/graph_view';
import {typeColor} from '../../../shared/graph/limit';
import {EmptyState} from '../../../shared/ui/empty_state';
import {schemaGraph} from '../model';

/** Schema graph props. */
export interface SchemaGraphProps {
  def: SchemaDef;
  selectedType?: string;
  onSelectType(apiName: string): void;
  height?: number | string;
}

/** Relation graph of the edited schema. */
export function SchemaGraph({
  def,
  selectedType,
  onSelectType,
  height = 420,
}: SchemaGraphProps) {
  const {t, i18n} = useTranslation('ontology');
  const lang = i18n.language;
  const {nodes, edges} = useMemo(
    () => schemaGraph(def, (text, fb) => resolveText(text, lang, fb) || fb),
    [def, lang],
  );
  const order = useMemo(
    () => def.objectTypes.map(o => o.apiName),
    [def.objectTypes],
  );
  if (!nodes.length)
    return (
      <EmptyState title={t('graph.empty')} description={t('graph.emptyHint')} />
    );
  return (
    <div className="flex flex-col gap-2">
      <GraphView
        nodes={nodes}
        edges={edges}
        mode="type"
        typeOrder={order}
        height={height}
        selectedId={selectedType}
        onNodeClick={n => onSelectType(n.id)}
        ariaLabel={t('graph.aria', {types: nodes.length, links: edges.length})}
      />
      <ul
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
        aria-label={t('graph.legend')}
      >
        {nodes.map(n => (
          <li key={n.id}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 hover:text-text"
              onClick={() => onSelectType(n.id)}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{background: typeColor(n.id, order)}}
              />
              {n.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
