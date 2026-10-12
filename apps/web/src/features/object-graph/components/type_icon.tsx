/**
 * @fileoverview Object type icon: maps the ontology `icon` name (lucide
 * kebab-case names such as `factory`, `package`, `box`) to a lucide icon,
 * with a colored dot variant for graph legends.
 */

import {
  Boxes,
  Box,
  Building2,
  Car,
  Cpu,
  Factory,
  FileText,
  Globe,
  MapPin,
  Package,
  ShieldAlert,
  ShoppingCart,
  Ship,
  Truck,
  User,
  Users,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {cn} from '../../../shared/lib/cn';

const ICONS: Record<string, LucideIcon> = {
  box: Box,
  boxes: Boxes,
  building: Building2,
  'building-2': Building2,
  car: Car,
  cpu: Cpu,
  factory: Factory,
  file: FileText,
  'file-text': FileText,
  globe: Globe,
  'map-pin': MapPin,
  package: Package,
  shield: ShieldAlert,
  'shopping-cart': ShoppingCart,
  ship: Ship,
  truck: Truck,
  user: User,
  users: Users,
  warehouse: Warehouse,
  wrench: Wrench,
};

/** Resolves an ontology icon name to a lucide component (fallback: Boxes). */
export function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name.toLowerCase()]) || Boxes;
}

/** Decorative object type icon. */
export function TypeIcon({
  icon,
  className,
}: {
  icon?: string;
  className?: string;
}) {
  const Icon = iconFor(icon);
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden />;
}
