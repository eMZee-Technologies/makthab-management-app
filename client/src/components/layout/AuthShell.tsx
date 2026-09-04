import type { ReactNode } from 'react';
import { GraduationCap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LocaleToggle } from '@/components/layout/LocaleToggle';

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,22rem)_1fr]">
      <aside className="relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground/15">
            <GraduationCap className="h-5 w-5" />
          </div>
          <p className="font-serif text-xl font-semibold tracking-tight">{t('app.name')}</p>
        </div>
        <div>
          <p className="font-serif text-3xl font-semibold leading-tight">{t('auth.railHeadline')}</p>
          <p className="mt-3 max-w-xs text-sm text-sidebar-muted">{t('app.tagline')}</p>
        </div>
        <p className="text-xs text-sidebar-muted">{t('auth.loginSubtitle')}</p>
      </aside>
      <div className="relative flex items-center justify-center bg-background p-6">
        <div className="absolute end-4 top-4">
          <LocaleToggle />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
