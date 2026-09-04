import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, CalendarCheck, Wallet, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingRows, ErrorState } from '@/components/QueryState';
import { formatCurrency, formatNumber, formatDate } from '@/lib/format';
import { useDashboard } from './api';
import type { DashboardStats } from '@/types/domain';

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-md p-2.5 ${accent ?? 'bg-primary/10 text-primary'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-semibold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MixBar({
  segments,
}: {
  segments: { key: string; label: string; value: number; className: string }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {total === 0 ? null : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.key}
                className={s.className}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.className}`} />
            {s.label} · {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function DashboardBody({ data, lang }: { data: DashboardStats; lang: string }) {
  const { t } = useTranslation();
  const marked = data.todayPresent + data.todayAbsent;
  const unmarked = Math.max(0, data.totalStudents - marked);
  const collectionTarget = data.monthCollection + data.outstanding;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label={t('dashboard.totalStudents')}
          value={formatNumber(data.totalStudents, lang)}
        />
        <StatCard
          icon={CalendarCheck}
          label={t('dashboard.todayAttendance')}
          value={`${formatNumber(data.todayPresent, lang)} / ${formatNumber(
            data.todayPresent + data.todayAbsent,
            lang,
          )}`}
          accent="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        />
        <StatCard
          icon={Wallet}
          label={t('dashboard.monthCollection')}
          value={formatCurrency(data.monthCollection, lang)}
          accent="bg-sky-500/10 text-sky-700 dark:text-sky-400"
        />
        <StatCard
          icon={AlertTriangle}
          label={t('dashboard.outstanding')}
          value={formatCurrency(data.outstanding, lang)}
          accent="bg-amber-500/10 text-amber-700 dark:text-amber-400"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">{t('dashboard.todayMix')}</h2>
          <MixBar
            segments={[
              {
                key: 'present',
                label: t('dashboard.present'),
                value: data.todayPresent,
                className: 'bg-emerald-600',
              },
              {
                key: 'absent',
                label: t('dashboard.absent'),
                value: data.todayAbsent,
                className: 'bg-destructive',
              },
              {
                key: 'unmarked',
                label: t('dashboard.unmarked'),
                value: unmarked,
                className: 'bg-muted-foreground/40',
              },
            ]}
          />
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">{t('dashboard.collectionVsTarget')}</h2>
          <MixBar
            segments={[
              {
                key: 'collected',
                label: t('dashboard.monthCollection'),
                value: data.monthCollection,
                className: 'bg-primary',
              },
              {
                key: 'due',
                label: t('dashboard.outstanding'),
                value: data.outstanding,
                className: 'bg-amber-500',
              },
            ]}
          />
          {collectionTarget > 0 && (
            <p className="text-xs text-muted-foreground">
              {formatCurrency(data.monthCollection, lang)} / {formatCurrency(collectionTarget, lang)}
            </p>
          )}
        </div>
      </div>

      {data.outstanding > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{t('dashboard.outstandingHint')}</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/fees">{t('dashboard.viewFees')}</Link>
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t('dashboard.recentActivity')}</h2>
        {!data.recentActivity || data.recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.activity')}</TableHead>
                <TableHead className="w-36 text-end">{t('dashboard.when')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentActivity.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="py-2.5">{a.description}</TableCell>
                  <TableCell className="py-2.5 text-end text-muted-foreground">
                    {formatDate(a.date, lang)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data, isLoading, isError, refetch } = useDashboard();

  return (
    <>
      <PageHeader title={t('dashboard.title')} description={t('dashboard.subtitle')} />
      {isLoading ? (
        <LoadingRows rows={2} cols={4} />
      ) : isError || !data ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <div className="space-y-5">
          <DashboardBody data={data} lang={lang} />
        </div>
      )}
    </>
  );
}
