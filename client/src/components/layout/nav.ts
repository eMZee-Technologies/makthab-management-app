import {
  LayoutDashboard,
  Users,
  UserCog,
  GraduationCap,
  ReceiptIndianRupee,
  CalendarCheck,
  Wallet,
  FileBarChart,
  Building2,
  ShieldCheck,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import { can, type Action, type ResourceKey, type RolePermissions } from '@makthab/shared';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Resource required to see this item. Empty = all authenticated users. */
  resource?: ResourceKey;
  action?: Action;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/students', labelKey: 'nav.students', icon: Users },
  { to: '/classes', labelKey: 'nav.classes', icon: GraduationCap, resource: 'classes', action: 'view' },
  { to: '/fees', labelKey: 'nav.fees', icon: ReceiptIndianRupee, resource: 'fees', action: 'view' },
  {
    to: '/attendance',
    labelKey: 'nav.attendance',
    icon: CalendarCheck,
    resource: 'attendance',
    action: 'view',
  },
  { to: '/finance', labelKey: 'nav.finance', icon: Wallet, resource: 'finance', action: 'view' },
  { to: '/reports', labelKey: 'nav.reports', icon: FileBarChart, resource: 'reports', action: 'view' },
  { to: '/users', labelKey: 'nav.users', icon: UserCog, resource: 'users', action: 'view' },
  {
    to: '/organisation',
    labelKey: 'nav.organisation',
    icon: Building2,
    resource: 'organisation',
    action: 'view',
  },
  { to: '/roles', labelKey: 'nav.roles', icon: ShieldCheck, resource: 'roles', action: 'view' },
  {
    to: '/audit-logs',
    labelKey: 'nav.auditLogs',
    icon: ScrollText,
    resource: 'admin',
    action: 'view',
  },
];

export function visibleNavItems(matrix: RolePermissions | undefined): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.resource || can(matrix, item.resource, item.action ?? 'view'),
  );
}
