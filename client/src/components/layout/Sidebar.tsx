import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { useActiveOrgProfile } from '@/features/org/api';
import { visibleNavItems } from './nav';

export function Sidebar() {
  const { t } = useTranslation();
  const permissions = useAuthStore((s) => s.user?.permissionMatrix);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebar = useUiStore((s) => s.setSidebar);
  const items = visibleNavItems(permissions);
  const { data: org } = useActiveOrgProfile();
  const orgName = org?.name ?? t('app.name');

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebar(false)}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 z-40 flex w-60 flex-col border-e bg-card transition-transform duration-200 lg:static lg:translate-x-0',
          'start-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-start justify-between gap-2 border-b px-4 py-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{orgName}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {org?.address || t('app.tagline')}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebar(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
          {items.map(({ to, labelKey, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => window.innerWidth < 1024 && setSidebar(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
