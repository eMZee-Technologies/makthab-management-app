import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/store/uiStore';
import { useActiveOrgProfile, useOrgImageUrl } from '@/features/org/api';
import { AcademicYearSwitcher } from './AcademicYearSwitcher';
import { LocaleToggle } from './LocaleToggle';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

function OrgBranding() {
  const { data: org } = useActiveOrgProfile();
  const imageUrl = useOrgImageUrl(org?.id, org?.headerImagePath);

  if (!org) return null;

  const hasImage = Boolean(imageUrl);

  return (
    <div className="relative overflow-hidden border-t">
      {hasImage && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${imageUrl})` }}
            aria-hidden
          />
          {/* Scrim: theme-independent dark wash so white text stays legible
              over any image in both light and dark mode. */}
          <div className="absolute inset-0 bg-black/55" aria-hidden />
        </>
      )}
      <div className="relative px-4 py-3 text-center">
        <h1
          className={`truncate text-xl font-bold leading-tight sm:text-2xl ${
            hasImage ? 'text-white drop-shadow' : 'text-foreground'
          }`}
        >
          {org.name}
        </h1>
        {org.address && (
          <p
            className={`mt-0.5 truncate text-sm ${
              hasImage ? 'text-white/85 drop-shadow' : 'text-muted-foreground'
            }`}
          >
            {org.address}
          </p>
        )}
      </div>
    </div>
  );
}

export function Header() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleSidebar} aria-label="Menu">
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex-1" />
        <AcademicYearSwitcher />
        <LocaleToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
      <OrgBranding />
    </header>
  );
}
