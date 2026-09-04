import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/store/uiStore';
import { useActiveOrgProfile } from '@/features/org/api';
import { AcademicYearSwitcher } from './AcademicYearSwitcher';
import { LocaleToggle } from './LocaleToggle';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

export function Header() {
  const { t } = useTranslation();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const { data: org } = useActiveOrgProfile();
  const title = org?.name ?? t('app.name');

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleSidebar} aria-label="Menu">
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1 lg:hidden">
          <p className="truncate text-sm font-semibold leading-tight">{title}</p>
        </div>
        <div className="hidden flex-1 lg:block" />
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <AcademicYearSwitcher />
          <LocaleToggle />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
