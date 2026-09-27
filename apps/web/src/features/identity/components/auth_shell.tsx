/**
 * @fileoverview Layout of the sign-up and login pages (效果图 c1): brand
 * area on the left ("用邮箱开始 3 天免费试用", data handling note and a
 * decorative ontology graph), the form card on the right.
 */

import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Brand} from '../../../shared/ui/brand';
import {LangSwitch} from './lang_switch';

const NODES: [number, number, 'c' | 'b' | 'v' | 'g', string?][] = [
  [60, 170, 'c', 'supplier'],
  [160, 150, 'b'],
  [240, 170, 'b', 'material'],
  [110, 110, 'b'],
  [150, 230, 'b'],
  [105, 225, 'b'],
  [230, 75, 'v'],
  [200, 70, 'v'],
  [330, 100, 'v', 'plant'],
  [360, 140, 'v'],
  [385, 160, 'v'],
  [380, 195, 'v'],
  [350, 205, 'v'],
  [300, 235, 'v'],
  [260, 255, 'v'],
  [170, 270, 'v'],
  [470, 80, 'g', 'order'],
  [520, 145, 'g'],
  [525, 180, 'g'],
  [505, 215, 'g'],
  [420, 50, 'g'],
  [255, 20, 'g'],
  [275, 25, 'g'],
  [455, 250, 'g'],
  [470, 245, 'g'],
  [415, 280, 'g'],
  [310, 295, 'g'],
  [270, 305, 'g'],
];

const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [1, 3],
  [2, 4],
  [2, 8],
  [2, 9],
  [2, 10],
  [2, 12],
  [2, 13],
  [3, 7],
  [7, 6],
  [8, 6],
  [8, 16],
  [8, 21],
  [8, 22],
  [9, 16],
  [10, 17],
  [10, 18],
  [11, 19],
  [11, 23],
  [12, 24],
  [12, 25],
  [13, 26],
  [14, 27],
  [4, 15],
  [15, 14],
  [9, 20],
];

const COLOR = {
  c: 'var(--cyan)',
  b: 'var(--blue)',
  v: 'var(--violet)',
  g: 'var(--dim)',
} as const;

function GraphArt() {
  const {t} = useTranslation('auth');
  return (
    <svg
      viewBox="0 0 560 320"
      className="w-full max-w-[560px]"
      role="img"
      aria-label={t('shell.graphLabel')}
    >
      {EDGES.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={NODES[a][0]}
          y1={NODES[a][1]}
          x2={NODES[b][0]}
          y2={NODES[b][1]}
          stroke="rgba(139,152,186,0.35)"
          strokeWidth={1}
        />
      ))}
      {NODES.map(([x, y, c, label], i) => (
        <g key={i}>
          <circle
            cx={x}
            cy={y}
            r={c === 'c' ? 16 : c === 'g' ? 9 : 12}
            fill={COLOR[c]}
            opacity={0.18}
          />
          <circle
            cx={x}
            cy={y}
            r={c === 'c' ? 11 : c === 'g' ? 5 : 8}
            fill={COLOR[c]}
          />
          {label && (
            <text x={x + 14} y={y + 4} fontSize={12} fill="var(--muted)">
              {t(`shell.node.${label}`)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Two-column auth layout. */
export function AuthShell({
  children,
  headline,
  headlineAccent,
  note,
}: {
  children: ReactNode;
  headline: string;
  headlineAccent: string;
  note: string;
}) {
  const {t} = useTranslation('common');
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="mx-auto grid min-h-screen max-w-[1440px] grid-cols-1 items-center gap-10 px-6 py-10 lg:grid-cols-[1fr_minmax(440px,540px)] lg:px-24">
        <section className="flex flex-col gap-8">
          <Brand edition={t('brand.edition')} />
          <div>
            <h1 className="text-4xl leading-tight font-bold tracking-tight text-text lg:text-5xl">
              {headline}
              <br />
              <span className="text-gradient">{headlineAccent}</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              {note}
            </p>
          </div>
          <div className="hidden lg:block">
            <GraphArt />
          </div>
        </section>
        <section className="glass shadow-[0_0_60px_color-mix(in_srgb,var(--cyan)_8%,transparent)]">
          <div className="p-8">{children}</div>
        </section>
      </div>
    </div>
  );
}

/** Card title row with the language switch. */
export function AuthCardHeader({title}: {title: string}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold text-text">{title}</h2>
      <LangSwitch />
    </div>
  );
}

/** Segmented step bar ("第 2 步，共 3 步 · 输入验证码"). */
export function StepBar({
  step,
  total,
  caption,
}: {
  step: number;
  total: number;
  caption: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex gap-2" aria-hidden>
        {Array.from({length: total}, (_, i) => (
          <span
            key={i}
            className={
              i < step
                ? 'h-1 flex-1 rounded-full bg-[linear-gradient(90deg,var(--cyan),var(--blue))]'
                : 'h-1 flex-1 rounded-full bg-line-2'
            }
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{caption}</p>
    </div>
  );
}
