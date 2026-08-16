import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { Pagination, DEFAULT_PAGE_SIZE } from '@/components/Pagination';
import { useToast } from '@/components/ui/use-toast';
import { useClasses } from '@/api/reference';
import { useDebounce } from '@/lib/useDebounce';
import { monthName } from '@/lib/format';
import { extractApiError } from '@/api/client';
import { useCan } from '@/lib/permissions';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { MonthlyProgress, ProgressBoardRow, Student } from '@/types/domain';
import { useDeleteProgress, useProgressBoard } from './api';
import { ProgressForm } from './ProgressForm';
import { WhatsAppLauncher } from './WhatsAppLauncher';

const now = new Date();

export function StudentProgressPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const can = useCan();
  const canCreate = can('progress', 'create');
  const canUpdate = can('progress', 'update');
  const canDelete = can('progress', 'delete');

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [classId, setClassId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const q = useDebounce(search);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProgressBoardRow | null>(null);
  const [waTarget, setWaTarget] = useState<ProgressBoardRow | null>(null);
  const [deleting, setDeleting] = useState<MonthlyProgress | null>(null);

  const { data: classes } = useClasses();
  const del = useDeleteProgress();

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 1, y, y + 1];
  }, []);

  const { data, isLoading, isError, refetch } = useProgressBoard({
    month,
    year,
    class_id: classId !== 'all' ? Number(classId) : undefined,
    q: q || undefined,
    page,
    limit,
  });

  const openCreate = (student: Student) => {
    setEditing({ student, progress: null });
    setFormOpen(true);
  };

  const openEdit = (row: ProgressBoardRow) => {
    setEditing(row);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('progress.deleted'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  return (
    <>
      <PageHeader
        title={t('progress.title')}
        description={t('progress.subtitle')}
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="ps-9"
                placeholder={t('common.searchStudent')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                aria-label={t('common.search')}
              />
            </div>
            <Select
              value={String(month)}
              onValueChange={(v) => {
                setMonth(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label={t('progress.month')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {monthName(m)}
                  </SelectItem>
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
              <SelectTrigger className="w-full sm:w-28" aria-label={t('progress.year')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={classId}
              onValueChange={(v) => {
                setClassId(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label={t('students.class')}>
                <SelectValue placeholder={t('common.all')} />
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

          {isLoading ? (
            <LoadingRows cols={9} />
          ) : isError ? (
            <ErrorState onRetry={() => void refetch()} />
          ) : !data?.items.length ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('students.admissionNo')}</TableHead>
                    <TableHead>{t('progress.studentName')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('students.category')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('students.class')}</TableHead>
                    <TableHead>{t('progress.topicsCovered')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('progress.attendanceDays')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('progress.progressPercent')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('progress.moodEngagement')}</TableHead>
                    <TableHead className="text-end">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row) => {
                    const p = row.progress;
                    return (
                      <TableRow key={row.student.id}>
                        <TableCell>{row.student.admissionNo}</TableCell>
                        <TableCell className="font-medium">{row.student.fullName}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {row.student.category?.name ?? '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {row.student.class?.name ?? '—'}
                        </TableCell>
                        <TableCell className="max-w-[14rem] truncate">
                          {p?.topicsCovered ?? (
                            <Badge variant="secondary">{t('progress.noReport')}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {p?.attendanceDays ?? '—'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {p?.progressPercent != null ? `${p.progressPercent}%` : '—'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {p ? t(`progress.mood.${p.moodEngagement}`) : '—'}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">
                            {p && canUpdate && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('progress.whatsappTitle')}
                                onClick={() => setWaTarget(row)}
                              >
                                <MessageCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {p && canUpdate ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('common.edit')}
                                onClick={() => openEdit(row)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : (
                              canCreate && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={t('progress.create')}
                                  onClick={() => openCreate(row.student)}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              )
                            )}
                            {p && canDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('common.delete')}
                                onClick={() => setDeleting(p)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {data && (
            <Pagination
              page={page}
              limit={limit}
              total={data.total}
              onPageChange={setPage}
              onLimitChange={(n) => {
                setLimit(n);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>

      {editing && (
        <ProgressForm
          open={formOpen}
          onOpenChange={setFormOpen}
          student={editing.student}
          month={month}
          year={year}
          progress={editing.progress}
        />
      )}

      {waTarget?.progress && (
        <WhatsAppLauncher
          open={Boolean(waTarget)}
          onOpenChange={(o) => {
            if (!o) setWaTarget(null);
          }}
          student={waTarget.student}
          progress={waTarget.progress}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={t('progress.deleteTitle')}
        message={t('progress.deleteConfirm')}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={confirmDelete}
        pending={del.isPending}
      />
    </>
  );
}
