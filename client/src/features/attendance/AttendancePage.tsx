import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { Pagination, DEFAULT_PAGE_SIZE } from '@/components/Pagination';
import { SortableTableHead, useSort } from '@/components/SortableTableHead';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { toDateInput, monthName } from '@/lib/format';
import { extractApiError } from '@/api/client';
import { useCan } from '@/lib/permissions';
import { useCategories, useClasses } from '@/api/reference';
import { useStudents } from '@/features/students/api';
import { useAttendanceSummary, useLowAlert, useMarkAttendance, type MarkRecord } from './api';

const STATUSES = ['present', 'absent', 'late', 'leave'] as const;
type Status = (typeof STATUSES)[number];
const now = new Date();

function MarkTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const can = useCan();
  const canCreate = can('attendance', 'create');
  const { data: classes = [] } = useClasses();
  const [classId, setClassId] = useState<number | undefined>();
  const [date, setDate] = useState(toDateInput(now));
  const { data: roster, isLoading } = useStudents({ class_id: classId, status: 'active', limit: 500 });
  const [marks, setMarks] = useState<Record<number, Status>>({});
  const mark = useMarkAttendance();

  useEffect(() => {
    const next: Record<number, Status> = {};
    (roster?.items ?? []).forEach((s) => (next[s.id] = 'present'));
    setMarks(next);
  }, [roster]);

  const students = roster?.items ?? [];

  const save = () => {
    const records: MarkRecord[] = students.map((s) => ({
      studentId: s.id,
      date,
      status: marks[s.id] ?? 'present',
    }));
    if (records.length === 0) return;
    mark.mutate(records, {
      onSuccess: () => toast({ title: t('attendance.saved'), variant: 'success' }),
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Select value={classId ? String(classId) : undefined} onValueChange={(v) => setClassId(Number(v))}>
              <SelectTrigger>
                <SelectValue placeholder={t('students.class')} />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
          {canCreate && (
            <Button onClick={save} disabled={mark.isPending || students.length === 0} className="ms-auto">
              {mark.isPending ? <Spinner className="me-2" /> : <Save className="h-4 w-4" />}
              {t('attendance.mark')}
            </Button>
          )}
        </div>

        {!classId ? (
          <EmptyState message={t('students.class')} />
        ) : isLoading ? (
          <LoadingRows cols={2} />
        ) : students.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('students.fullName')}</TableHead>
                <TableHead className="w-48">{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.admissionNo} — {s.fullName}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={marks[s.id] ?? 'present'}
                      onValueChange={(v) => setMarks((m) => ({ ...m, [s.id]: v as Status }))}
                      disabled={!canCreate}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((st) => (
                          <SelectItem key={st} value={st} className="capitalize">{st}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryTab() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const { sort, toggle } = useSort({ sortBy: '', sortOrder: 'asc' });
  const { data: categories = [] } = useCategories();
  const { data, isLoading, isError, refetch } = useAttendanceSummary({
    month,
    year,
    category_id: categoryId,
    page,
    limit,
    sortBy: sort.sortBy || undefined,
    sortOrder: sort.sortBy ? sort.sortOrder : undefined,
  });
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const onSort = (key: string) => {
    toggle(key);
    setPage(1);
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex gap-2">
          <Select
            value={String(month)}
            onValueChange={(v) => {
              setMonth(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(year)}
            onValueChange={(v) => {
              setYear(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={categoryId ? String(categoryId) : 'all'}
            onValueChange={(v) => {
              setCategoryId(v === 'all' ? undefined : Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-48"><SelectValue placeholder={t('classes.categories')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
                <SortableTableHead sortKey="fullName" sort={sort} onSort={onSort}>
                  {t('students.fullName')}
                </SortableTableHead>
                <SortableTableHead sortKey="present" sort={sort} onSort={onSort} className="text-end">
                  {t('attendance.present')}
                </SortableTableHead>
                <SortableTableHead sortKey="absent" sort={sort} onSort={onSort} className="text-end">
                  {t('attendance.absent')}
                </SortableTableHead>
                <SortableTableHead sortKey="totalDays" sort={sort} onSort={onSort} className="text-end">
                  {t('common.total')}
                </SortableTableHead>
                <SortableTableHead sortKey="percentage" sort={sort} onSort={onSort} className="text-end">
                  {t('attendance.percentage')}
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
                <TableRow key={r.studentId}>
                  <TableCell className="font-medium">{r.fullName}</TableCell>
                  <TableCell className="text-end">{r.present}</TableCell>
                  <TableCell className="text-end">{r.absent}</TableCell>
                  <TableCell className="text-end">{r.totalDays}</TableCell>
                  <TableCell className="text-end">
                    <Badge variant={r.percentage >= 75 ? 'success' : 'warning'}>{r.percentage}%</Badge>
                  </TableCell>
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
      </CardContent>
    </Card>
  );
}

function LowAlertTab() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useLowAlert();
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {isLoading ? (
          <LoadingRows cols={2} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : !data || data.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('students.fullName')}</TableHead>
                <TableHead className="text-end">{t('attendance.percentage')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.studentId}>
                  <TableCell className="font-medium">{r.fullName}</TableCell>
                  <TableCell className="text-end">
                    <Badge variant="destructive">{r.percentage}%</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function AttendancePage() {
  const { t } = useTranslation();
  const can = useCan();
  const canCreate = can('attendance', 'create');
  return (
    <>
      <PageHeader title={t('attendance.title')} description={t('attendance.subtitle')} />
      <Tabs defaultValue={canCreate ? 'mark' : 'summary'}>
        <TabsList>
          {canCreate && <TabsTrigger value="mark">{t('attendance.mark')}</TabsTrigger>}
          <TabsTrigger value="summary">{t('attendance.summary')}</TabsTrigger>
          <TabsTrigger value="low">{t('attendance.lowAlert')}</TabsTrigger>
        </TabsList>
        {canCreate && (
          <TabsContent value="mark"><MarkTab /></TabsContent>
        )}
        <TabsContent value="summary"><SummaryTab /></TabsContent>
        <TabsContent value="low"><LowAlertTab /></TabsContent>
      </Tabs>
    </>
  );
}
