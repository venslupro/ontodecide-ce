/**
 * @fileoverview Default cockpit layout (12 columns).
 */

import type {CockpitLayout, CockpitWidget} from '../contract';

/** Id of the default layout. */
export const DEFAULT_LAYOUT_ID = 'default';

/**
 * Builds the default layout: a row of up to four KPI cards, a trend of the
 * first KPI next to the alert list, then recommendations, impacted objects
 * and data health.
 */
export function defaultLayout(kpiIds: readonly string[] = []): CockpitLayout {
  const widgets: CockpitWidget[] = [];
  const cards = kpiIds.slice(0, 4);
  const w = cards.length > 0 ? Math.floor(12 / cards.length) : 3;
  cards.forEach((kpiId, i) =>
    widgets.push({
      id: `kpi-${i + 1}`,
      kind: 'kpi',
      x: i * w,
      y: 0,
      w,
      h: 2,
      binding: {kpiId},
    }),
  );
  const top = cards.length > 0 ? 2 : 0;
  widgets.push(
    {
      id: 'trend-1',
      kind: 'trend',
      x: 0,
      y: top,
      w: 8,
      h: 4,
      ...(kpiIds[0] ? {binding: {kpiId: kpiIds[0]}} : {}),
    },
    {id: 'alerts', kind: 'alerts', x: 8, y: top, w: 4, h: 4},
    {
      id: 'recommendations',
      kind: 'recommendations',
      x: 0,
      y: top + 4,
      w: 6,
      h: 4,
    },
    {id: 'impacted', kind: 'impacted', x: 6, y: top + 4, w: 6, h: 4},
    {id: 'data-health', kind: 'dataHealth', x: 0, y: top + 8, w: 12, h: 2},
  );
  return {id: DEFAULT_LAYOUT_ID, name: 'Default', columns: 12, widgets};
}
