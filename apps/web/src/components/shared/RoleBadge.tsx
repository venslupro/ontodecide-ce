/**
 * RoleBadge — colored pill for UserRole (admin / user).
 * Uses shared types: UserRole = 'admin' | 'user'.
 */
import type { UserRole } from '@ontodecide/shared';
import Badge, { BadgeTone } from '@/components/ui/Badge';

const toneMap: Record<UserRole, BadgeTone> = {
  admin: 'danger',
  user:  'primary',
};
const labelMap: Record<UserRole, string> = {
  admin: 'Admin',
  user:  'User',
};

export interface RoleBadgeProps {
  role: UserRole;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

export default function RoleBadge({
  role, className, style, ariaLabel,
}: RoleBadgeProps) {
  return (
    <Badge
      tone={toneMap[role]}
      className={className}
      style={style}
      aria-label={ariaLabel ?? `User role: ${role}`}
    >
      {labelMap[role]}
    </Badge>
  );
}
