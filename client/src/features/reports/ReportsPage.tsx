import { useEffect, useState, Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, FileText, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { Pagination, DEFAULT_PAGE_SIZE } from '@/components/Pagination';
import { SortableTableHead, useSort } from '@/components/SortableTableHead';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency, formatNumber, formatDate, monthName } from '@/lib/format';
import { downloadFile } from '@/lib/download';
import { extractApiError } from '@/api/client';
import { useFees, useDefaulters, useContributions } from '@/features/fees/api';
import { useExpenses, useSalaries } from '@/features/finance/api';
import { useCategories, useClasses } from '@/api/reference';
import type { FeePayment, Expense, SalaryPayment, Defaulter, Contribution } from '@/types/domain';
import type { StudentProgressReportRow } from '@makthab/shared';
import {
  useFeeCollectionYearSummary,
  useFeeCollectionAllSummary,
  useSalaryRegisterYearSummary,
  useSalaryRegisterAllSummary,
  useFinancialSummaryYearSummary,
  useFinancialSummaryAllSummary,
  useStudentProgressReportSummary,
} from './api';

const now = new Date();

function useReportDownload() {
  const { toast } = useToast();
  return async (path: string, filename: string, params: Record<string, unknown>) => {
    try {
      await downloadFile(`/reports/${path}`, filename, params);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };
}

function MonthSelect({ month, onMonth }: { month: number; onMonth: (m: number) => void }) {
  return (
    <Select value={String(month)} onValueChange={(v) => onMonth(Number(v))}>
      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        {Array.from({ length: 12 }, (_, i) => (
          <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function YearSelect({
  year,
  onYear,
  id,
}: {
  year: number;
  onYear: (y: number) => void;
  id?: string;
}) {
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
  return (
    <Select value={String(year)} onValueChange={(v) => onYear(Number(v))}>
      <SelectTrigger id={id} className="w-28"><SelectValue /></SelectTrigger>
      <SelectContent>
        {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function DownloadButtons({
  onPdf,
  onExcel,
}: {
  onPdf: () => void;
  onExcel?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={onPdf}>
        <FileText className="h-4 w-4" />{t('common.pdf')}
      </Button>
      {onExcel && (
        <Button variant="outline" size="sm" onClick={onExcel}>
          <FileSpreadsheet className="h-4 w-4" />{t('common.excel')}
        </Button>
      )}
    </div>
  );
}

/** Wraps a tab's filter controls and download buttons in the shared card shell. */
function ReportTabCard({ filters, buttons, children }: { filters: ReactNode; buttons: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">{filters}</div>
          {buttons}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** Read-only, paginated fee-payment list rendered below a report tab's filters. */
function ReportPaymentsTable({
  feeType,
  month,
  year,
  showFeeType,
}: {
  feeType: 'monthly' | 'admission';
  month?: number;
  year?: number;
  showFeeType?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [feeType, month, year]);

  const { data, isLoading, isError, refetch } = useFees({ feeType, month, year, page, limit });
  const cols = showFeeType ? 7 : 6;

  return (
    <>
      {isLoading ? (
        <LoadingRows cols={cols} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fees.receiptNo')}</TableHead>
              <TableHead>{t('fees.student')}</TableHead>
              <TableHead>{t('fees.admissionNo')}</TableHead>
              {showFeeType && <TableHead>{t('fees.feeType')}</TableHead>}
              <TableHead className="text-end">{t('fees.amountPaid')}</TableHead>
              <TableHead>{t('fees.paymentMethod')}</TableHead>
              <TableHead>{t('fees.paymentDate')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((f: FeePayment) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.receiptNo}</TableCell>
                <TableCell>{f.student?.fullName ?? f.studentId}</TableCell>
                <TableCell>{f.student?.admissionNo ?? '-'}</TableCell>
                {showFeeType && <TableCell className="capitalize">{f.feeType}</TableCell>}
                <TableCell className="text-end">{formatCurrency(f.amountPaid, i18n.language)}</TableCell>
                <TableCell className="capitalize">{f.paymentMethod}</TableCell>
                <TableCell>{formatDate(f.paymentDate, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={showFeeType ? 4 : 3}>{t('common.total')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalPaid, i18n.language)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <Pagination
          page={page}
          limit={limit}
          total={data.total}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
        />
      )}
    </>
  );
}

function MonthYearReportTab({ path, filename, pdfOnly }: { path: string; filename: string; pdfOnly?: boolean }) {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const download = useReportDownload();
  const base = { month, year };
  return (
    <ReportTabCard
      filters={
        <>
          <MonthSelect month={month} onMonth={setMonth} />
          <YearSelect year={year} onYear={setYear} />
        </>
      }
      buttons={
        <DownloadButtons
          onPdf={() => download(path, `${filename}.pdf`, base)}
          onExcel={pdfOnly ? undefined : () => download(path, `${filename}.xlsx`, { ...base, format: 'xlsx' })}
        />
      }
    />
  );
}

function MonthlyFeesYearView() {
  const { t, i18n } = useTranslation();
  const [year, setYear] = useState(now.getFullYear());
  const download = useReportDownload();
  const { data, isLoading, isError, refetch } = useFeeCollectionYearSummary(year);

  return (
    <ReportTabCard
      filters={<YearSelect year={year} onYear={setYear} />}
      buttons={
        <DownloadButtons
          onPdf={() => download('fee-collection', `Monthly-Fee-Report-${year}.pdf`, { view: 'year', year })}
          onExcel={() =>
            download('fee-collection', `Monthly-Fee-Report-${year}.xlsx`, { view: 'year', year, format: 'xlsx' })
          }
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={3} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('reports.month')}</TableHead>
              <TableHead className="text-end">{t('reports.payments')}</TableHead>
              <TableHead className="text-end">{t('reports.totalPaid')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="font-medium">{monthName(m.month)}</TableCell>
                <TableCell className="text-end">{formatNumber(m.count, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(m.totalPaid, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{t('common.total')}</TableCell>
              <TableCell className="text-end">
                {formatNumber(data.months.reduce((s, m) => s + m.count, 0), i18n.language)}
              </TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalPaid, i18n.language)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportTabCard>
  );
}

function MonthlyFeesAllView() {
  const { t, i18n } = useTranslation();
  const download = useReportDownload();
  const { data, isLoading, isError, refetch } = useFeeCollectionAllSummary();

  return (
    <ReportTabCard
      filters={null}
      buttons={
        <DownloadButtons
          onPdf={() => download('fee-collection', 'Monthly-Fee-Report-All.pdf', { view: 'all' })}
          onExcel={() => download('fee-collection', 'Monthly-Fee-Report-All.xlsx', { view: 'all', format: 'xlsx' })}
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={3} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.years.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('reports.year')}</TableHead>
              <TableHead className="text-end">{t('reports.payments')}</TableHead>
              <TableHead className="text-end">{t('reports.totalPaid')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.years.map((y) => (
              <TableRow key={y.year}>
                <TableCell className="font-medium">{y.year}</TableCell>
                <TableCell className="text-end">{formatNumber(y.count, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.totalPaid, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{t('common.total')}</TableCell>
              <TableCell className="text-end">
                {formatNumber(data.years.reduce((s, y) => s + y.count, 0), i18n.language)}
              </TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalPaid, i18n.language)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportTabCard>
  );
}

function MonthlyFeesMonthView() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const download = useReportDownload();
  const base = { month, year };
  const filename = `Monthly-Fee-Report-${monthName(month).slice(0, 3)}-${year}`;
  return (
    <ReportTabCard
      filters={
        <>
          <MonthSelect month={month} onMonth={setMonth} />
          <YearSelect year={year} onYear={setYear} />
        </>
      }
      buttons={
        <DownloadButtons
          onPdf={() => download('fee-collection', `${filename}.pdf`, base)}
          onExcel={() => download('fee-collection', `${filename}.xlsx`, { ...base, format: 'xlsx' })}
        />
      }
    >
      <ReportPaymentsTable feeType="monthly" month={month} year={year} showFeeType />
    </ReportTabCard>
  );
}

function MonthlyFeesTab() {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="yearMonth">
      <TabsList>
        <TabsTrigger value="year">{t('reports.viewYear')}</TabsTrigger>
        <TabsTrigger value="yearMonth">{t('reports.viewYearMonth')}</TabsTrigger>
        <TabsTrigger value="all">{t('reports.viewAll')}</TabsTrigger>
      </TabsList>
      <TabsContent value="year"><MonthlyFeesYearView /></TabsContent>
      <TabsContent value="yearMonth"><MonthlyFeesMonthView /></TabsContent>
      <TabsContent value="all"><MonthlyFeesAllView /></TabsContent>
    </Tabs>
  );
}

function AdmissionFeesTab() {
  const { t } = useTranslation();
  const [year, setYear] = useState<string>('all');
  const download = useReportDownload();
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];
  const base = year === 'all' ? {} : { year: Number(year) };
  const filename = year === 'all' ? 'Admission-Fee-Report-All' : `Admission-Fee-Report-${year}`;
  return (
    <ReportTabCard
      filters={
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('fees.allYears')}</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      }
      buttons={
        <DownloadButtons
          onPdf={() => download('admission-fee-collection', `${filename}.pdf`, base)}
          onExcel={() => download('admission-fee-collection', `${filename}.xlsx`, { ...base, format: 'xlsx' })}
        />
      }
    >
      <ReportPaymentsTable feeType="admission" year={year === 'all' ? undefined : Number(year)} />
    </ReportTabCard>
  );
}

/** Read-only, paginated contribution list for reports. */
function ReportContributionsTable({ year }: { year?: number }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [year]);

  const { data, isLoading, isError, refetch } = useContributions({ year, page, limit });

  return (
    <>
      {isLoading ? (
        <LoadingRows cols={6} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fees.receiptNo')}</TableHead>
              <TableHead>{t('fees.contributorName')}</TableHead>
              <TableHead>{t('fees.contributorType')}</TableHead>
              <TableHead className="text-end">{t('fees.contributionAmount')}</TableHead>
              <TableHead>{t('fees.contributionDate')}</TableHead>
              <TableHead>{t('fees.contributionNotes')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((c: Contribution) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.receiptNo}</TableCell>
                <TableCell>{c.contributorName}</TableCell>
                <TableCell>
                  {c.contributorType === 'anonymous'
                    ? t('fees.contributorAnonymous')
                    : t('fees.contributorIndividual')}
                </TableCell>
                <TableCell className="text-end">{formatCurrency(c.amount, i18n.language)}</TableCell>
                <TableCell>{formatDate(c.date, i18n.language)}</TableCell>
                <TableCell className="max-w-[12rem] truncate">{c.notes ?? '-'}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={3}>{t('common.total')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalAmount, i18n.language)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <Pagination
          page={page}
          limit={limit}
          total={data.total}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
        />
      )}
    </>
  );
}

function ContributionsAllView() {
  return (
    <ReportTabCard filters={null} buttons={null}>
      <ReportContributionsTable />
    </ReportTabCard>
  );
}

function ContributionsYearView() {
  const [year, setYear] = useState(now.getFullYear());
  return (
    <ReportTabCard
      filters={<YearSelect year={year} onYear={setYear} />}
      buttons={null}
    >
      <ReportContributionsTable year={year} />
    </ReportTabCard>
  );
}

function ContributionsTab() {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="all">
      <TabsList>
        <TabsTrigger value="all">{t('reports.viewAll')}</TabsTrigger>
        <TabsTrigger value="year">{t('reports.viewYear')}</TabsTrigger>
      </TabsList>
      <TabsContent value="all"><ContributionsAllView /></TabsContent>
      <TabsContent value="year"><ContributionsYearView /></TabsContent>
    </Tabs>
  );
}

/** Read-only, paginated expense list for a single year (or all years). */
function ReportExpensesTable({ dateFrom, dateTo }: { dateFrom?: string; dateTo?: string }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo]);

  const { data, isLoading, isError, refetch } = useExpenses({ date_from: dateFrom, date_to: dateTo, page, limit });

  return (
    <>
      {isLoading ? (
        <LoadingRows cols={5} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('expenses.voucherNo')}</TableHead>
              <TableHead>{t('expenses.category')}</TableHead>
              <TableHead>{t('expenses.payee')}</TableHead>
              <TableHead className="text-end">{t('expenses.amount')}</TableHead>
              <TableHead>{t('expenses.date')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((e: Expense) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.voucherNo}</TableCell>
                <TableCell>{e.category?.name ?? '-'}</TableCell>
                <TableCell>{e.payee}</TableCell>
                <TableCell className="text-end">{formatCurrency(e.amount, i18n.language)}</TableCell>
                <TableCell>{formatDate(e.expenseDate, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={3}>{t('common.total')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalAmount, i18n.language)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <Pagination
          page={page}
          limit={limit}
          total={data.total}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
        />
      )}
    </>
  );
}

function ExpenseTab() {
  const { t } = useTranslation();
  const [year, setYear] = useState<string>('all');
  const download = useReportDownload();
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];
  const isAll = year === 'all';
  const base = isAll ? {} : { period: Number(year) };
  const filename = isAll ? 'Expense-Report-All' : `Expense-Report-${year}`;
  return (
    <ReportTabCard
      filters={
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('fees.allYears')}</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      }
      buttons={
        <DownloadButtons
          onPdf={() => download('expenses', `${filename}.pdf`, base)}
          onExcel={() => download('expenses', `${filename}.xlsx`, { ...base, format: 'xlsx' })}
        />
      }
    >
      <ReportExpensesTable
        dateFrom={isAll ? undefined : `${year}-01-01`}
        dateTo={isAll ? undefined : `${year}-12-31T23:59:59.999Z`}
      />
    </ReportTabCard>
  );
}

/** Read-only, paginated salary-payment detail list for a month/year. */
function ReportSalariesTable({ month, year }: { month: number; year: number }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [month, year]);

  const { data, isLoading, isError, refetch } = useSalaries({ month, year, page, limit });

  return (
    <>
      {isLoading ? (
        <LoadingRows cols={5} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('salaries.staff')}</TableHead>
              <TableHead className="text-end">{t('salaries.gross')}</TableHead>
              <TableHead className="text-end">{t('salaries.deductions')}</TableHead>
              <TableHead className="text-end">{t('salaries.net')}</TableHead>
              <TableHead>{t('salaries.paymentDate')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((s: SalaryPayment) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.staff?.fullName ?? s.staffId}</TableCell>
                <TableCell className="text-end">{formatCurrency(s.grossAmount, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(s.deductions, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(s.netAmount, i18n.language)}</TableCell>
                <TableCell>{formatDate(s.paymentDate, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={3}>{t('common.total')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalNet, i18n.language)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <Pagination
          page={page}
          limit={limit}
          total={data.total}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
        />
      )}
    </>
  );
}

function SalaryYearView() {
  const { t, i18n } = useTranslation();
  const [year, setYear] = useState(now.getFullYear());
  const download = useReportDownload();
  const { data, isLoading, isError, refetch } = useSalaryRegisterYearSummary(year);

  return (
    <ReportTabCard
      filters={<YearSelect year={year} onYear={setYear} />}
      buttons={
        <DownloadButtons
          onPdf={() => download('salary-register', `Salary-Report-${year}.pdf`, { view: 'year', year })}
          onExcel={() =>
            download('salary-register', `Salary-Report-${year}.xlsx`, { view: 'year', year, format: 'xlsx' })
          }
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={3} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('reports.month')}</TableHead>
              <TableHead className="text-end">{t('reports.payments')}</TableHead>
              <TableHead className="text-end">{t('reports.totalNet')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell className="font-medium">{monthName(m.month)}</TableCell>
                <TableCell className="text-end">{formatNumber(m.count, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(m.totalNet, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{t('common.total')}</TableCell>
              <TableCell className="text-end">
                {formatNumber(data.months.reduce((s, m) => s + m.count, 0), i18n.language)}
              </TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalNet, i18n.language)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportTabCard>
  );
}

function SalaryMonthYearView() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const download = useReportDownload();
  const base = { month, year };
  const filename = `Salary-Report-${monthName(month).slice(0, 3)}-${year}`;
  return (
    <ReportTabCard
      filters={
        <>
          <MonthSelect month={month} onMonth={setMonth} />
          <YearSelect year={year} onYear={setYear} />
        </>
      }
      buttons={
        <DownloadButtons
          onPdf={() => download('salary-register', `${filename}.pdf`, base)}
          onExcel={() => download('salary-register', `${filename}.xlsx`, { ...base, format: 'xlsx' })}
        />
      }
    >
      <ReportSalariesTable month={month} year={year} />
    </ReportTabCard>
  );
}

function SalaryAllView() {
  const { t, i18n } = useTranslation();
  const download = useReportDownload();
  const { data, isLoading, isError, refetch } = useSalaryRegisterAllSummary();

  return (
    <ReportTabCard
      filters={null}
      buttons={
        <DownloadButtons
          onPdf={() => download('salary-register', 'Salary-Report-All.pdf', { view: 'all' })}
          onExcel={() => download('salary-register', 'Salary-Report-All.xlsx', { view: 'all', format: 'xlsx' })}
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={3} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.years.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('reports.year')}</TableHead>
              <TableHead className="text-end">{t('reports.payments')}</TableHead>
              <TableHead className="text-end">{t('reports.totalNet')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.years.map((y) => (
              <TableRow key={y.year}>
                <TableCell className="font-medium">{y.year}</TableCell>
                <TableCell className="text-end">{formatNumber(y.count, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.totalNet, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{t('common.total')}</TableCell>
              <TableCell className="text-end">
                {formatNumber(data.years.reduce((s, y) => s + y.count, 0), i18n.language)}
              </TableCell>
              <TableCell className="text-end">{formatCurrency(data.totalNet, i18n.language)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportTabCard>
  );
}

function SalariesTab() {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="monthYear">
      <TabsList>
        <TabsTrigger value="year">{t('reports.viewYear')}</TabsTrigger>
        <TabsTrigger value="monthYear">{t('reports.viewYearMonth')}</TabsTrigger>
        <TabsTrigger value="all">{t('reports.viewAll')}</TabsTrigger>
      </TabsList>
      <TabsContent value="year"><SalaryYearView /></TabsContent>
      <TabsContent value="monthYear"><SalaryMonthYearView /></TabsContent>
      <TabsContent value="all"><SalaryAllView /></TabsContent>
    </Tabs>
  );
}

function FinancialSummaryYearView() {
  const { t, i18n } = useTranslation();
  const [year, setYear] = useState(now.getFullYear());
  const download = useReportDownload();
  const { data, isLoading, isError, refetch } = useFinancialSummaryYearSummary(year);

  return (
    <ReportTabCard
      filters={<YearSelect year={year} onYear={setYear} />}
      buttons={
        <DownloadButtons
          onPdf={() => download('financial-summary', `Financial-Summary-${year}.pdf`, { view: 'year', year })}
          onExcel={() =>
            download('financial-summary', `Financial-Summary-${year}.xlsx`, { view: 'year', year, format: 'xlsx' })
          }
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={2} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('reports.lineItem')}</TableHead>
              <TableHead className="text-end">{t('expenses.amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">{t('reports.monthlyFee')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.monthlyFee, i18n.language)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">{t('reports.admissionFee')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.admissionFee, i18n.language)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">{t('reports.contributions')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.contributions, i18n.language)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">{t('nav.expenses')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.expenses, i18n.language)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">{t('nav.salaries')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.salaries, i18n.language)}</TableCell>
            </TableRow>
            <TableRow className="font-semibold">
              <TableCell>{t('reports.netBalance')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.netBalance, i18n.language)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportTabCard>
  );
}

function FinancialSummaryAllView() {
  const { t, i18n } = useTranslation();
  const download = useReportDownload();
  const { data, isLoading, isError, refetch } = useFinancialSummaryAllSummary();

  return (
    <ReportTabCard
      filters={null}
      buttons={
        <DownloadButtons
          onPdf={() => download('financial-summary', 'Financial-Summary-All.pdf', { view: 'all' })}
          onExcel={() => download('financial-summary', 'Financial-Summary-All.xlsx', { view: 'all', format: 'xlsx' })}
        />
      }
    >
      {isLoading ? (
        <LoadingRows cols={7} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.years.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('reports.year')}</TableHead>
              <TableHead className="text-end">{t('reports.monthlyFee')}</TableHead>
              <TableHead className="text-end">{t('reports.admissionFee')}</TableHead>
              <TableHead className="text-end">{t('reports.contributions')}</TableHead>
              <TableHead className="text-end">{t('nav.expenses')}</TableHead>
              <TableHead className="text-end">{t('nav.salaries')}</TableHead>
              <TableHead className="text-end">{t('reports.netBalance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.years.map((y) => (
              <TableRow key={y.year}>
                <TableCell className="font-medium">{y.year}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.monthlyFee, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.admissionFee, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.contributions, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.expenses, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.salaries, i18n.language)}</TableCell>
                <TableCell className="text-end">{formatCurrency(y.netBalance, i18n.language)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{t('common.total')}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totals.monthlyFee, i18n.language)}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totals.admissionFee, i18n.language)}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totals.contributions, i18n.language)}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totals.expenses, i18n.language)}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totals.salaries, i18n.language)}</TableCell>
              <TableCell className="text-end">{formatCurrency(data.totals.netBalance, i18n.language)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportTabCard>
  );
}

function FinancialSummaryTab() {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="year">
      <TabsList>
        <TabsTrigger value="year">{t('reports.viewYear')}</TabsTrigger>
        <TabsTrigger value="all">{t('reports.viewAll')}</TabsTrigger>
      </TabsList>
      <TabsContent value="year"><FinancialSummaryYearView /></TabsContent>
      <TabsContent value="all"><FinancialSummaryAllView /></TabsContent>
    </Tabs>
  );
}

/** Read-only, paginated defaulter list for a month/year. */
function ReportDefaultersTable({ month, year }: { month: number; year: number }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [month, year]);

  const { data, isLoading, isError, refetch } = useDefaulters({ month, year, page, limit });

  return (
    <>
      {isLoading ? (
        <LoadingRows cols={5} />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fees.admissionNo')}</TableHead>
              <TableHead>{t('fees.student')}</TableHead>
              <TableHead>{t('students.class')}</TableHead>
              <TableHead className="text-end">{t('fees.amountDue')}</TableHead>
              <TableHead className="text-end">{t('reports.contact')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((d: Defaulter) => (
              <TableRow key={d.studentId}>
                <TableCell className="font-medium">{d.admissionNo}</TableCell>
                <TableCell>{d.fullName}</TableCell>
                <TableCell>{d.className ?? '-'}</TableCell>
                <TableCell className="text-end">{formatCurrency(d.amountDue, i18n.language)}</TableCell>
                <TableCell className="text-end">{d.whatsappNo ? Number(d.whatsappNo) : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <Pagination
          page={page}
          limit={limit}
          total={data.total}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
        />
      )}
    </>
  );
}

function DefaultersReportTab() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const download = useReportDownload();
  const base = { month, year };
  const filename = `Defaulters-Report-${monthName(month)}-${year}`;
  return (
    <ReportTabCard
      filters={
        <>
          <MonthSelect month={month} onMonth={setMonth} />
          <YearSelect year={year} onYear={setYear} />
        </>
      }
      buttons={
        <DownloadButtons
          onPdf={() => download('defaulters', `${filename}.pdf`, base)}
          onExcel={() => download('defaulters', `${filename}.xlsx`, { ...base, format: 'xlsx' })}
        />
      }
    >
      <ReportDefaultersTable month={month} year={year} />
    </ReportTabCard>
  );
}

function StudentProgressReportTable({
  year,
  month,
  classId,
  categoryId,
}: {
  year: number;
  month?: number;
  classId?: number;
  categoryId?: number;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const { sort, toggle } = useSort({ sortBy: 'fullName', sortOrder: 'asc' });
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [year, month, classId, categoryId, sort.sortBy, sort.sortOrder]);

  const { data, isLoading, isError, refetch } = useStudentProgressReportSummary({
    year,
    month,
    class_id: classId,
    category_id: categoryId,
    page,
    limit,
    sortBy: sort.sortBy || undefined,
    sortOrder: sort.sortBy ? sort.sortOrder : undefined,
  });

  const onSort = (key: string) => {
    toggle(key);
    setPage(1);
  };

  return (
    <>
      {isLoading ? (
        <LoadingRows cols={8} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState message={t('reports.studentProgressEmpty')} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 md:hidden">
                  <span className="sr-only">{t('reports.details')}</span>
                </TableHead>
                <SortableTableHead sortKey="admissionNo" sort={sort} onSort={onSort}>
                  {t('fees.admissionNo')}
                </SortableTableHead>
                <SortableTableHead sortKey="fullName" sort={sort} onSort={onSort}>
                  {t('students.fullName')}
                </SortableTableHead>
                <TableHead className="hidden sm:table-cell">{t('students.class')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('students.category')}</TableHead>
                <SortableTableHead sortKey="month" sort={sort} onSort={onSort}>
                  {t('reports.month')}
                </SortableTableHead>
                <SortableTableHead
                  sortKey="hoursStudied"
                  sort={sort}
                  onSort={onSort}
                  className="hidden lg:table-cell text-end"
                >
                  {t('progress.hoursStudied')}
                </SortableTableHead>
                <TableHead className="hidden lg:table-cell">{t('progress.topicsCovered')}</TableHead>
                <SortableTableHead
                  sortKey="attendanceDays"
                  sort={sort}
                  onSort={onSort}
                  className="text-end"
                >
                  {t('progress.attendanceDays')}
                </SortableTableHead>
                <SortableTableHead
                  sortKey="progressPercent"
                  sort={sort}
                  onSort={onSort}
                  className="hidden sm:table-cell text-end"
                >
                  {t('progress.progressPercent')}
                </SortableTableHead>
                <TableHead className="hidden xl:table-cell">{t('progress.moodEngagement')}</TableHead>
                <TableHead className="hidden xl:table-cell">{t('progress.assessments')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((row: StudentProgressReportRow) => {
                const open = expanded === row.id;
                return (
                  <Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="md:hidden">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-expanded={open}
                          aria-label={t('reports.details')}
                          onClick={() => setExpanded(open ? null : row.id)}
                        >
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{row.admissionNo}</TableCell>
                      <TableCell>{row.fullName}</TableCell>
                      <TableCell className="hidden sm:table-cell">{row.className ?? '—'}</TableCell>
                      <TableCell className="hidden md:table-cell">{row.categoryName ?? '—'}</TableCell>
                      <TableCell>
                        {monthName(row.month)} {formatNumber(row.year, i18n.language)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-end">
                        {formatNumber(row.hoursStudied, i18n.language)}
                      </TableCell>
                      <TableCell className="hidden max-w-[12rem] truncate lg:table-cell">
                        {row.topicsCovered}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatNumber(row.attendanceDays, i18n.language)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-end">
                        {row.progressPercent != null
                          ? `${formatNumber(row.progressPercent, i18n.language)}%`
                          : '—'}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {t(`progress.mood.${row.moodEngagement}`, {
                          defaultValue: row.moodEngagement.replace(/_/g, ' '),
                        })}
                      </TableCell>
                      <TableCell className="hidden max-w-[10rem] truncate xl:table-cell">
                        {row.assessments}
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="bg-muted/40 md:hidden">
                        <TableCell colSpan={6}>
                          <dl className="grid gap-2 text-sm sm:grid-cols-2">
                            <div>
                              <dt className="text-muted-foreground">{t('students.class')}</dt>
                              <dd>{row.className ?? '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t('students.category')}</dt>
                              <dd>{row.categoryName ?? '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t('progress.hoursStudied')}</dt>
                              <dd>{formatNumber(row.hoursStudied, i18n.language)}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t('progress.topicsCovered')}</dt>
                              <dd>{row.topicsCovered}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t('progress.assessments')}</dt>
                              <dd>{row.assessments}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t('progress.moodEngagement')}</dt>
                              <dd>
                                {t(`progress.mood.${row.moodEngagement}`, {
                                  defaultValue: row.moodEngagement.replace(/_/g, ' '),
                                })}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t('progress.goals')}</dt>
                              <dd>{row.goals}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t('progress.notes')}</dt>
                              <dd>{row.notes}</dd>
                            </div>
                            {row.nextSteps && (
                              <div className="sm:col-span-2">
                                <dt className="text-muted-foreground">{t('progress.nextSteps')}</dt>
                                <dd>{row.nextSteps}</dd>
                              </div>
                            )}
                          </dl>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {data && data.total > 0 && (
        <Pagination
          page={page}
          limit={limit}
          total={data.total}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
        />
      )}
    </>
  );
}

function StudentProgressReportTab() {
  const { t } = useTranslation();
  const [month, setMonth] = useState<string>('all');
  const [year, setYear] = useState(now.getFullYear());
  const [classId, setClassId] = useState<string>('all');
  const [categoryId, setCategoryId] = useState<string>('all');
  const download = useReportDownload();
  const { data: classes } = useClasses();
  const { data: categories } = useCategories();

  const monthNum = month === 'all' ? undefined : Number(month);
  const classNum = classId === 'all' ? undefined : Number(classId);
  const categoryNum = categoryId === 'all' ? undefined : Number(categoryId);
  const base = {
    year,
    ...(monthNum ? { month: monthNum } : {}),
    ...(classNum ? { class_id: classNum } : {}),
    ...(categoryNum ? { category_id: categoryNum } : {}),
  };
  const filename = `Student-Progress-${monthNum ? monthName(monthNum) + '-' : ''}${year}`;

  return (
    <ReportTabCard
      filters={
        <>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="sp-month">
              {t('reports.month')}
            </label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger id="sp-month" className="w-36" aria-label={t('reports.month')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {monthName(i + 1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="sp-year">
              {t('reports.year')}
            </label>
            <YearSelect id="sp-year" year={year} onYear={setYear} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="sp-class">
              {t('students.class')}
            </label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger id="sp-class" className="w-40" aria-label={t('students.class')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {(classes ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="sp-category">
              {t('students.category')}
            </label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="sp-category" className="w-44" aria-label={t('students.category')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      }
      buttons={
        <DownloadButtons
          onPdf={() => download('student-progress', `${filename}.pdf`, base)}
          onExcel={() =>
            download('student-progress', `${filename}.xlsx`, { ...base, format: 'xlsx' })
          }
        />
      }
    >
      <StudentProgressReportTable
        year={year}
        month={monthNum}
        classId={classNum}
        categoryId={categoryNum}
      />
    </ReportTabCard>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('reports.title')} />
      <Tabs defaultValue="monthlyFees">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="monthlyFees">{t('reports.monthlyFees')}</TabsTrigger>
          <TabsTrigger value="admissionFees">{t('reports.admissionFees')}</TabsTrigger>
          <TabsTrigger value="contributions">{t('reports.contributions')}</TabsTrigger>
          <TabsTrigger value="expense">{t('reports.expense')}</TabsTrigger>
          <TabsTrigger value="salaries">{t('reports.salaries')}</TabsTrigger>
          <TabsTrigger value="financialSummary">{t('reports.financialSummary')}</TabsTrigger>
          <TabsTrigger value="defaulters">{t('reports.defaulters')}</TabsTrigger>
          <TabsTrigger value="attendance">{t('reports.attendance')}</TabsTrigger>
          <TabsTrigger value="studentProgress">{t('reports.studentProgress')}</TabsTrigger>
        </TabsList>
        <TabsContent value="monthlyFees"><MonthlyFeesTab /></TabsContent>
        <TabsContent value="admissionFees"><AdmissionFeesTab /></TabsContent>
        <TabsContent value="contributions"><ContributionsTab /></TabsContent>
        <TabsContent value="expense"><ExpenseTab /></TabsContent>
        <TabsContent value="salaries"><SalariesTab /></TabsContent>
        <TabsContent value="financialSummary"><FinancialSummaryTab /></TabsContent>
        <TabsContent value="defaulters"><DefaultersReportTab /></TabsContent>
        <TabsContent value="attendance">
          <MonthYearReportTab path="attendance" filename="attendance" />
        </TabsContent>
        <TabsContent value="studentProgress">
          <StudentProgressReportTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
