/**
 * @fileoverview React wrapper around the tree-shaken ECharts core. The
 * option builder receives theme tokens so colors always come from tokens;
 * the chart is re-themed when `data-theme` changes and resized with its box.
 */

import type {EChartsCoreOption} from 'echarts/core';
import {useEffect, useMemo, useRef} from 'react';
import {cn} from '../lib/cn';
import {type ChartTokens, useChartTokens} from './theme';

type EChartsModule = typeof import('./echarts');
type Instance = ReturnType<EChartsModule['echarts']['init']>;

/** Base option applied under every chart (text, tooltip, grid). */
export function baseOption(t: ChartTokens): EChartsCoreOption {
  return {
    backgroundColor: 'transparent',
    textStyle: {color: t.muted, fontFamily: t.fontFamily},
    animationDuration: 250,
    animationEasing: 'cubicOut',
    grid: {left: 8, right: 12, top: 28, bottom: 8, containLabel: true},
    tooltip: {
      backgroundColor: t.panel,
      borderColor: t.line2,
      textStyle: {color: t.text, fontSize: 12},
    },
    aria: {enabled: true},
  };
}

/** Axis defaults (9% grid lines). */
export function axisStyle(t: ChartTokens) {
  return {
    axisLine: {lineStyle: {color: t.line2}},
    axisTick: {show: false},
    axisLabel: {color: t.dim, fontSize: 11},
    splitLine: {lineStyle: {color: t.grid}},
  };
}

/** Whether a 2D canvas context can be created. */
export function canvasAvailable(): boolean {
  try {
    return (
      typeof document !== 'undefined' &&
      !!document.createElement('canvas').getContext('2d')
    );
  } catch {
    return false;
  }
}

/** Chart component. */
export function EChart({
  option,
  height = 240,
  className,
  ariaLabel,
  onEvents,
}: {
  option: (t: ChartTokens) => EChartsCoreOption;
  height?: number | string;
  className?: string;
  ariaLabel: string;
  onEvents?: Record<string, (params: unknown) => void>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<Instance | null>(null);
  const tokens = useChartTokens();
  const built = useMemo(
    () => ({...baseOption(tokens), ...option(tokens)}),
    [option, tokens],
  );
  const latest = useRef(built);
  latest.current = built;

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | undefined;
    void import('./echarts')
      .then(({echarts}) => {
        if (disposed || !el.current) return;
        // No 2D canvas (jsdom, some locked-down browsers): keep the aria label only.
        if (!canvasAvailable()) return;
        try {
          inst.current = echarts.init(el.current, undefined, {
            renderer: 'canvas',
          });
          inst.current.setOption(latest.current, true);
          if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => inst.current?.resize());
            ro.observe(el.current);
          }
        } catch {
          // Canvas unavailable (e.g. jsdom): leave the accessible label only.
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      ro?.disconnect();
      try {
        inst.current?.dispose();
      } catch {
        // ignore
      }
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(built, true);
  }, [built]);

  useEffect(() => {
    const i = inst.current;
    if (!i || !onEvents) return undefined;
    for (const [name, fn] of Object.entries(onEvents)) i.on(name, fn);
    return () => {
      for (const [name, fn] of Object.entries(onEvents)) i.off(name, fn);
    };
  }, [onEvents, built]);

  return (
    <div
      ref={el}
      role="img"
      aria-label={ariaLabel}
      className={cn('w-full', className)}
      style={{height}}
    />
  );
}
