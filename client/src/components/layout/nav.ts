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
  type LucideIcon,
} from 'lucide-react';
export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Permission key required to see this item. Empty = all authenticated users. */
  permission?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/students', labelKey: 'nav.students', icon: Users },
  { to: '/classes', labelKey: 'nav.classes', icon: GraduationCap, permission: 'classes.manage' },
  { to: '/fees', labelKey: 'nav.fees', icon: ReceiptIndianRupee, permission: 'fees.manage' },
  { to: '/attendance', labelKey: 'nav.attendance', icon: CalendarCheck, permission: 'attendance.mark' },
  { to: '/finance', labelKey: 'nav.finance', icon: Wallet, permission: 'finance.manage' },
  { to: '/reports', labelKey: 'nav.reports', icon: FileBarChart, permission: 'reports.access' },
  { to: '/users', labelKey: 'nav.users', icon: UserCog, permission: 'users.manage' },
  { to: '/organisation', labelKey: 'nav.organisation', icon: Building2, permission: 'org.manage' },
  { to: '/roles', labelKey: 'nav.roles', icon: ShieldCheck, permission: 'roles.manage' },
];

export function visibleNavItems(permissions: string[] | undefined): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.permission || (permissions?.includes(item.permission) ?? false),
  );
}
