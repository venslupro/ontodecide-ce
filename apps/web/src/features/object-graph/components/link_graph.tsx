/**
 * @fileoverview Relationship subgraph around an object (≤ 2 hops, ≤ 300
 * nodes), coloured by object type with a legend. Cytoscape + fcose are
 * lazy-loaded by `GraphView`.
 */

import type {GraphSlice} from '@ontodecide/object-graph/contract';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {GraphView} from '../../../shared/graph/graph_view';
import {typeColor, type GNode} from '../../../shared/graph/limit';
import {sliceToGraph, sliceTypes} from '../model';

/** Legend of object types. */
export function TypeLegend({types}: {types: readonly string[]}) {
  const {model} = useUiModel();
  const order = model.types.map(t => t.apiName);
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-muted">
      {types.map(ty => (
        <li key={ty} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{background: typeColor(ty, order)}}
          />
          {model.byName[ty]?.displayName ?? ty}
        </li>
      ))}
    </ul>
  );
}

/** Graph with legend. */
export function LinkGraph({
  slice,
  rootRid,
  height = 380,
  onNodeClick,
  onNodeDoubleClick,
}: {
  slice: GraphSlice | undefined;
  rootRid?: string;
  height?: number;
  onNodeClick?(n: GNode): void;
  onNodeDoubleClick?(n: GNode): void;
}) {
  const {t} = useTranslation('objects');
  const {model} = useUiModel();
  const g = useMemo(() => sliceToGraph(slice, rootRid), [slice, rootRid]);
  const types = useMemo(() => sliceTypes(slice), [slice]);
  const order = useMemo(() => model.types.map(ty => ty.apiName), [model.types]);
  if (!slice) return null;
  return (
    <div className="flex flex-col gap-2">
      <GraphView
        nodes={g.nodes}
        edges={g.edges}
        typeOrder={order}
        height={height}
        selectedId={rootRid}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        ariaLabel={t('graph.aria', {count: g.nodes.length})}
      />
      {slice.truncated && <p className="text-xs text-warn">{t('graph.cut')}</p>}
      <TypeLegend types={types} />
    </div>
  );
}
