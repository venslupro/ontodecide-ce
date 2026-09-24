/**
 * @fileoverview Navigation menu definition; items are hidden by role.
 */

import type {Role} from '@ontodecide/shared-kernel';
import {
  Activity,
  Bot,
  Boxes,
  Database,
  FlaskConical,
  Gauge,
  Lightbulb,
  Network,
  Shapes,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** One navigation entry. */
export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  minRole: Role;
  group: 'monitor' | 'decide' | 'data' | 'admin';
}

/** Menu entries in display order. */
export const NAV_ITEMS: NavItem[] = [
  {
    to: '/cockpit',
    labelKey: 'nav.cockpit',
    icon: Gauge,
    minRole: 'Viewer',
    group: 'monitor',
  },
  {
    to: '/objects',
    labelKey: 'nav.objects',
    icon: Boxes,
    minRole: 'Viewer',
    group: 'monitor',
  },
  {
    to: '/graph',
    labelKey: 'nav.graph',
    icon: Network,
    minRole: 'Viewer',
    group: 'monitor',
  },
  {
    to: '/scenarios',
    labelKey: 'nav.scenarios',
    icon: FlaskConical,
    minRole: 'Operator',
    group: 'decide',
  },
  {
    to: '/recommendations',
    labelKey: 'nav.recommendations',
    icon: Lightbulb,
    minRole: 'Operator',
    group: 'decide',
  },
  {
    to: '/automations',
    labelKey: 'nav.automations',
    icon: Bot,
    minRole: 'Operator',
    group: 'decide',
  },
  {
    to: '/sources',
    labelKey: 'nav.sources',
    icon: Database,
    minRole: 'Operator',
    group: 'data',
  },
  {
    to: '/ontology',
    labelKey: 'nav.ontology',
    icon: Shapes,
    minRole: 'Modeler',
    group: 'data',
  },
  {
    to: '/admin/users',
    labelKey: 'nav.users',
    icon: Users,
    minRole: 'Admin',
    group: 'admin',
  },
  {
    to: '/admin/health',
    labelKey: 'nav.health',
    icon: Activity,
    minRole: 'Admin',
    group: 'admin',
  },
];
