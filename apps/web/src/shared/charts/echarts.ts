/**
 * @fileoverview Tree-shaken ECharts core with only the charts/components the
 * app uses. Imported lazily by chart components (own chunk).
 */

import {BarChart, HeatmapChart, LineChart} from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import {init, use} from 'echarts/core';
import {CanvasRenderer} from 'echarts/renderers';

use([
  LineChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  VisualMapComponent,
  AriaComponent,
  CanvasRenderer,
]);

/** Minimal ECharts API used by the chart wrapper. */
export const echarts = {init};
