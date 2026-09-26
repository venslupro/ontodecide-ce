/**
 * @fileoverview Cytoscape + fcose graph view. Nodes are colored by object
 * type; in impact mode node fill uses the orange single-hue scale and size
 * encodes impact. Graphs above the limit are folded into "+N" nodes.
 */

import type {Core, ElementDefinition} from 'cytoscape';
import {useEffect, useMemo, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {impactColor, useChartTokens} from '../charts/theme';
import {cn} from '../lib/cn';
import {
  type GEdge,
  type GNode,
  GRAPH_NODE_DEFAULT,
  limitGraph,
  typeColor,
} from './limit';

let fcoseRegistered = false;

async function loadCytoscape() {
  const [{default: cytoscape}, {default: fcose}] = await Promise.all([
    import('cytoscape'),
    import('cytoscape-fcose'),
  ]);
  if (!fcoseRegistered) {
    cytoscape.use(fcose);
    fcoseRegistered = true;
  }
  return cytoscape;
}

/** Graph view props. */
export interface GraphViewProps {
  nodes: readonly GNode[];
  edges: readonly GEdge[];
  mode?: 'type' | 'impact';
  maxNodes?: number;
  height?: number | string;
  typeOrder?: readonly string[];
  selectedId?: string;
  onNodeClick?(node: GNode): void;
  onNodeDoubleClick?(node: GNode): void;
  ariaLabel: string;
  className?: string;
}

/** Interactive graph. */
export function GraphView({
  nodes,
  edges,
  mode = 'type',
  maxNodes = GRAPH_NODE_DEFAULT,
  height = 420,
  typeOrder,
  selectedId,
  onNodeClick,
  onNodeDoubleClick,
  ariaLabel,
  className,
}: GraphViewProps) {
  const {t} = useTranslation('common');
  const el = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const tokens = useChartTokens();
  const limited = useMemo(
    () => limitGraph(nodes, edges, maxNodes),
    [nodes, edges, maxNodes],
  );
  const handlers = useRef({onNodeClick, onNodeDoubleClick});
  handlers.current = {onNodeClick, onNodeDoubleClick};

  const elements = useMemo<ElementDefinition[]>(() => {
    const byId = new Map(limited.nodes.map(n => [n.id, n] as const));
    return [
      ...limited.nodes.map(n => ({
        data: {
          id: n.id,
          label: n.label,
          type: n.type,
          color: n.hidden
            ? tokens.dim
            : mode === 'impact'
              ? impactColor(n.impact ?? 0, tokens.orange)
              : typeColor(n.type, typeOrder),
          size: n.hidden
            ? 34
            : mode === 'impact'
              ? 18 + 30 * Math.max(0, Math.min(1, n.impact ?? 0))
              : n.root
                ? 34
                : 24,
          border: n.root ? tokens.cyan : 'transparent',
          raw: n,
        },
        classes: [n.hidden ? 'agg' : '', n.root ? 'root' : ''].join(' ').trim(),
      })),
      ...limited.edges
        .filter(e => byId.has(e.source) && byId.has(e.target))
        .map((e, i) => ({
          data: {
            id: e.id ?? `e${i}:${e.source}:${e.target}:${e.type}`,
            source: e.source,
            target: e.target,
            label: e.label ?? '',
          },
        })),
    ];
  }, [limited, mode, tokens, typeOrder]);

  useEffect(() => {
    let disposed = false;
    void loadCytoscape()
      .then(cytoscape => {
        if (disposed || !el.current) return;
        try {
          const inst = cytoscape({
            container: el.current,
            elements,
            wheelSensitivity: 0.25,
            minZoom: 0.2,
            maxZoom: 3,
            style: [
              {
                selector: 'node',
                style: {
                  'background-color': 'data(color)',
                  width: 'data(size)',
                  height: 'data(size)',
                  label: 'data(label)',
                  color: tokens.text,
                  'font-size': 10,
                  'text-valign': 'bottom',
                  'text-margin-y': 4,
                  'text-max-width': '110px',
                  'text-wrap': 'ellipsis',
                  'border-width': 2,
                  'border-color': 'data(border)',
                },
              },
              {
                selector: 'node.agg',
                style: {
                  shape: 'round-rectangle',
                  'text-valign': 'center',
                  'text-margin-y': 0,
                  color: tokens.text,
                  'font-weight': 'bold',
                },
              },
              {
                selector: 'node:selected',
                style: {'border-color': tokens.cyan, 'border-width': 3},
              },
              {
                selector: 'edge',
                style: {
                  width: 1.2,
                  'line-color': tokens.line2,
                  'target-arrow-color': tokens.line2,
                  'target-arrow-shape': 'triangle',
                  'arrow-scale': 0.8,
                  'curve-style': 'bezier',
                  label: 'data(label)',
                  'font-size': 8,
                  color: tokens.dim,
                  'text-rotation': 'autorotate',
                },
              },
            ],
            layout: {
              name: 'fcose',
              animate: false,
              randomize: true,
              nodeRepulsion: () => 6500,
              idealEdgeLength: () => 90,
            } as never,
          });
          inst.on('tap', 'node', ev => {
            const raw = ev.target.data('raw') as GNode;
            handlers.current.onNodeClick?.(raw);
          });
          inst.on('dbltap', 'node', ev => {
            const raw = ev.target.data('raw') as GNode;
            handlers.current.onNodeDoubleClick?.(raw);
          });
          cy.current = inst;
        } catch {
          // Canvas unavailable (jsdom): fall back to the accessible list.
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      cy.current?.destroy();
      cy.current = null;
    };
    // Re-create on element/theme changes; layout is fast for ≤ 500 nodes.
  }, [elements, tokens]);

  useEffect(() => {
    const inst = cy.current;
    if (!inst || !selectedId) return;
    inst.$(':selected').unselect();
    inst.$id(selectedId).select();
  }, [selectedId, elements]);

  return (
    <div className={cn('relative', className)}>
      <div
        ref={el}
        role="img"
        aria-label={ariaLabel}
        className="w-full"
        style={{height}}
      />
      {limited.hiddenCount > 0 && (
        <p className="absolute top-2 right-2 rounded-md border border-line-2 bg-panel-solid/90 px-2 py-1 text-xs text-muted">
          {t('graph.truncated', {
            shown:
              limited.nodes.length - limited.nodes.filter(n => n.hidden).length,
            hidden: limited.hiddenCount,
          })}
        </p>
      )}
      {/* Screen-reader alternative listing the nodes. */}
      <ul className="sr-only">
        {limited.nodes.slice(0, 50).map(n => (
          <li key={n.id}>
            {n.label} ({n.type})
          </li>
        ))}
      </ul>
    </div>
  );
}
