/**
 * @fileoverview Impact scope of a scenario: the affected objects in impact
 * mode (orange single-hue scale, node size = normalized |delta|), with edges
 * from the 2-hop links of the first perturbed object that connect affected
 * objects. Header 「n 跳 · m 个对象」, legend 「节点大小与颜色深浅 = 影响程度」.
 */

import type {ScenarioResult} from '@ontodecide/decision/contract';
import {useNavigate} from '@tanstack/react-router';
import {Network} from 'lucide-react';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {useLinks} from '../../object-graph/api';
import {GraphView} from '../../../shared/graph/graph_view';
import {Badge} from '../../../shared/ui/badge';
import {Panel} from '../../../shared/ui/card';
import {EmptyState} from '../../../shared/ui/empty_state';
import {impactGraph} from '../model';

/** Impact graph panel. */
export function ImpactPanel({
  result,
  focusRid,
  className,
}: {
  result?: ScenarioResult;
  focusRid?: string;
  className?: string;
}) {
  const {t} = useTranslation('scenarios');
  const navigate = useNavigate();
  const links = useLinks(result ? focusRid : undefined, 2);
  const graph = useMemo(
    () => impactGraph(result, links.data),
    [result, links.data],
  );
  const count = result?.nodeCount ?? graph.nodes.length;
  return (
    <Panel
      className={className}
      title={t('impact.title')}
      icon={<Network aria-hidden />}
      subtitle={result ? t('impact.legend') : undefined}
      actions={
        result ? (
          <Badge tone="orange">
            {t('impact.summary', {hops: graph.hops, count})}
          </Badge>
        ) : undefined
      }
    >
      {result ? (
        <GraphView
          nodes={graph.nodes}
          edges={graph.edges}
          mode="impact"
          height={440}
          ariaLabel={t('impact.graphAria', {count})}
          onNodeClick={n =>
            void navigate({to: '/objects/$rid', params: {rid: n.id}})
          }
        />
      ) : (
        <EmptyState icon={<Network aria-hidden />} title={t('impact.empty')} />
      )}
    </Panel>
  );
}
