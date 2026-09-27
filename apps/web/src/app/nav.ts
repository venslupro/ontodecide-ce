/**
 * @fileoverview Navigation (前端详细设计 2.1): 运营 / 构建 / 我的, plus the
 * admin-only 平台 group (display only; the gateway enforces role).
 */

import {
  Boxes,
  FlaskConical,
  LayoutGrid,
  Layers,
  Network,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** One navigation entry. */
export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

/** A navigation group. */
export interface NavGroup {
  key: 'operate' | 'build' | 'mine' | 'platform';
  items: NavItem[];
  adminOnly?: boolean;
}

/** Menu in display order. */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'operate',
    items: [
      {to: '/cockpit', labelKey: 'nav.cockpit', icon: LayoutGrid},
      {to: '/objects', labelKey: 'nav.objects', icon: Boxes},
      {to: '/graph', labelKey: 'nav.graph', icon: Network},
      {to: '/scenarios', labelKey: 'nav.scenarios', icon: FlaskConical},
      {to: '/recommendations', labelKey: 'nav.recommendations', icon: Sparkles},
    ],
  },
  {
    key: 'build',
    items: [
      {to: '/imports', labelKey: 'nav.imports', icon: Upload},
      {to: '/ontology', labelKey: 'nav.ontology', icon: Layers},
      {to: '/automations', labelKey: 'nav.automations', icon: Zap},
    ],
  },
  {
    key: 'mine',
    items: [{to: '/account', labelKey: 'nav.account', icon: User}],
  },
  {
    key: 'platform',
    adminOnly: true,
    items: [{to: '/admin', labelKey: 'nav.admin', icon: ShieldCheck}],
  },
];

/** Groups visible to a role. */
export function visibleGroups(isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.filter(g => !g.adminOnly || isAdmin);
}
