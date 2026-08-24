/**
 * UserStateBadge — lifecycle pill for a user account.
 * Maps UserState (pending / active / disabled / data_cleared) to Badge tone.
 */
import type { UserState } from '@ontodecide/shared';
import Badge, { BadgeTone } from '@/components/ui/Badge';

const toneMap: Record<UserState, BadgeTone> = {
  pending:      'warning',
  active:       'success',
  disabled:     'default',
  data_cleared: 'info',
};
const labelMap: Record<UserState, string> = {
  pending:      'Pending',
  active:       'Active',
  disabled:     'Disabled',
  data_cleared: 'Data Cleared',
};

export interface UserStateBadgeProps {
  state: UserState;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

export default function UserStateBadge({
  state, className, style, ariaLabel,
}: UserStateBadgeProps) {
  return (
    <Badge
      tone={toneMap[state]}
      className={className}
      style={style}
      aria-label={ariaLabel ?? `User state: ${state}`}
    >
      {labelMap[state]}
    </Badge>
  );
}
