/**
 * @fileoverview Badges, including status badges that always pair color with
 * an icon and text (WCAG: never color alone), AI and degraded markers.
 */

import {cva, type VariantProps} from 'class-variance-authority';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  CloudOff,
} from 'lucide-react';
import type {HTMLAttributes, ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../lib/cn';

/** Badge variants. */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-line-2 bg-panel-2 text-muted',
        cyan: 'border-cyan/40 bg-cyan/10 text-cyan',
        blue: 'border-blue/40 bg-blue/10 text-blue',
        violet: 'border-violet/40 bg-violet/10 text-violet',
        orange: 'border-orange/40 bg-orange/10 text-orange',
        good: 'border-good/40 bg-good/10 text-good',
        warn: 'border-warn/40 bg-warn/10 text-warn',
        crit: 'border-crit/40 bg-crit/10 text-crit',
      },
    },
    defaultVariants: {tone: 'neutral'},
  },
);

/** Badge props. */
export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Small pill label. */
export function Badge({className, tone, ...props}: BadgeProps) {
  return <span className={cn(badgeVariants({tone}), className)} {...props} />;
}

/** Status levels. */
export type StatusLevel = 'good' | 'warn' | 'crit' | 'info';

const STATUS_ICON: Record<StatusLevel, ReactNode> = {
  good: <CheckCircle2 aria-hidden />,
  warn: <AlertTriangle aria-hidden />,
  crit: <AlertOctagon aria-hidden />,
  info: <Info aria-hidden />,
};

/** Status badge: icon + text + color. */
export function StatusBadge({
  level,
  children,
  className,
}: {
  level: StatusLevel;
  children: ReactNode;
  className?: string;
}) {
  const tone = level === 'info' ? 'blue' : level;
  return (
    <Badge tone={tone} className={className}>
      {STATUS_ICON[level]}
      {children}
    </Badge>
  );
}

/** Alert severity. */
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Maps severity to a status level. */
export function severityLevel(s: SeverityLevel | string): StatusLevel {
  if (s === 'CRITICAL' || s === 'HIGH') return 'crit';
  if (s === 'MEDIUM') return 'warn';
  return 'info';
}

/** Severity badge with localized label. */
export function SeverityBadge({
  severity,
  className,
}: {
  severity: SeverityLevel | string;
  className?: string;
}) {
  const {t} = useTranslation('common');
  return (
    <StatusBadge level={severityLevel(severity)} className={className}>
      {t(`severity.${severity}`, {defaultValue: severity})}
    </StatusBadge>
  );
}

/** Marks AI-generated content (must be confirmed by a human). */
export function AiBadge({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const {t} = useTranslation('common');
  return (
    <Badge tone="violet" className={className} title={t('ai.hint')}>
      <Sparkles aria-hidden />
      {label ?? t('ai.badge')}
    </Badge>
  );
}

/** Degraded marker shown next to widget titles when `degraded: true`. */
export function DegradedBadge({
  reason,
  className,
}: {
  reason?: string;
  className?: string;
}) {
  const {t} = useTranslation('common');
  return (
    <Badge
      tone="warn"
      className={className}
      title={reason ?? t('degraded.hint')}
    >
      <CloudOff aria-hidden />
      {t('degraded.badge')}
    </Badge>
  );
}
