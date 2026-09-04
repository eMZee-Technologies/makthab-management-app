import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, CalendarCheck, Wallet, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingRows, ErrorState } from '@/components/QueryState';
import { DualLineChart, DonutChart } from '@/components/charts/OpsCharts';
import { formatCurrency, formatNumber, formatDate } from '@/lib/format';
import { useDashboard } from './api';
import type { DashboardStats } from '@/types/domain';

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <p className="mt-3 font-serif text-2xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardBody({ data, lang }: { data: DashboardStats; lang: string }) {
  const { t } = useTranslation();
  const marked =
    data.todayPresent + (data.todayAbsent ?? 0) + (data.todayLate ?? 0) + (data.todayLeave ?? 0);
  const unmarked = Math.max(0, data.totalStudents - marked);
  const collectionTarget = data.monthCollection + data.outstanding;
  const trend = data.collectionTrend ?? [];
  const monthFmt = new Intl.DateTimeFormat(lang.startsWith('ar') ? 'ar' : 'en', { month: 'short' });

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
          value={`${formatNumber(data.todayPresent, lang)} / ${formatNumber(data.totalStudents, lang)}`}
          hint={t('dashboard.present')}
        />
        <StatCard
          icon={Wallet}
          label={t('dashboard.monthCollection')}
          value={formatCurrency(data.monthCollection, lang)}
        />
        <StatCard
          icon={AlertTriangle}
          label={t('dashboard.outstanding')}
          value={formatCurrency(data.outstanding, lang)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="mb-3 font-serif text-lg font-semibold">{t('dashboard.monthlyCollection')}</h2>
          {trend.length > 0 ? (
            <DualLineChart
              categories={trend.map((m) => monthFmt.format(new Date(m.year, m.month - 1, 1)))}
              series={[
                {
                  name: t('dashboard.feesSeries'),
                  data: trend.map((m) => m.fees),
                  color: 'hsl(var(--chart-fees))',
                },
                {
                  name: t('dashboard.contribSeries'),
                  data: trend.map((m) => m.contributions),
                  color: 'hsl(var(--chart-contrib))',
                },
              ]}
            />
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.collectionCaption')}</p>
        </div>
        <div>
          <h2 className="mb-3 font-serif text-lg font-semibold">{t('dashboard.todayMix')}</h2>
          <DonutChart
            center={`${formatNumber(data.todayPresent, lang)}`}
            slices={[
              { key: 'present', label: t('dashboard.present'), value: data.todayPresent, color: 'hsl(var(--primary))' },
              { key: 'late', label: t('dashboard.late'), value: data.todayLate ?? 0, color: 'hsl(32 72% 42%)' },
              { key: 'absent', label: t('dashboard.absent'), value: data.todayAbsent, color: 'hsl(var(--destructive))' },
              { key: 'leave', label: t('attendance.leave'), value: data.todayLeave ?? 0, color: 'hsl(var(--muted-foreground))' },
              { key: 'unmarked', label: t('dashboard.unmarked'), value: unmarked, color: 'hsl(var(--border))' },
            ]}
          />
        </div>
      </div>

      {collectionTarget > 0 && (
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{t('dashboard.collectionVsTarget')}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatCurrency(data.monthCollection, lang)} / {formatCurrency(collectionTarget, lang)}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="bg-primary"
              style={{ width: `${Math.min(100, (data.monthCollection / collectionTarget) * 100)}%` }}
            />
            <div
              className="bg-amber-500"
              style={{ width: `${Math.min(100, (data.outstanding / collectionTarget) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {data.outstanding > 0 && (
        <div className="flex flex-col gap-2 border border-amber-600/25 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{t('dashboard.outstandingHint')}</p>
          <Button asChild size="sm">
            <Link to="/fees">{t('dashboard.viewFees')}</Link>
          </Button>
        </div>
      )}

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">{t('dashboard.recentActivity')}</h2>
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
        <div className="space-y-8">
          <DashboardBody data={data} lang={lang} />
        </div>
      )}
    </>
  );
}
