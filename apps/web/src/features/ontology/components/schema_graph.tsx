/**
 * @fileoverview Schema relationship graph: object types as nodes, link
 * types as edges (GraphView, Cytoscape lazy-loaded; screen readers get the
 * list fallback). Clicking a node selects the object type.
 */

import type {OntologyDef} from '@ontodecide/ontology/contract';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {GraphView} from '../../../shared/graph/graph_view';
import {schemaGraph} from '../model';

/** Schema graph props. */
export interface SchemaGraphProps {
  ontology: OntologyDef;
  locale: string;
  selectedType?: string;
  onSelectType(apiName: string): void;
  height?: number;
}

/** The graph. */
export function SchemaGraph({
  ontology,
  locale,
  selectedType,
  onSelectType,
  height = 360,
}: SchemaGraphProps) {
  const {t} = useTranslation('ontology');
  const g = useMemo(() => schemaGraph(ontology, locale), [ontology, locale]);
  return (
    <GraphView
      nodes={g.nodes}
      edges={g.edges}
      mode="type"
      height={height}
      typeOrder={g.nodes.map(n => n.id)}
      selectedId={selectedType}
      ariaLabel={t('graph.aria', {
        types: g.nodes.length,
        links: g.edges.length,
      })}
      onNodeClick={n => onSelectType(n.id)}
    />
  );
}
