import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, FileText, Pencil, Trash2 } from 'lucide-react';
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
import { SortableTableHead, useSort } from '@/components/SortableTableHead';
import { useToast } from '@/components/ui/use-toast';
import { useClasses } from '@/api/reference';
import { useUiStore } from '@/store/uiStore';
import { useDebounce } from '@/lib/useDebounce';
import { formatDate, computeAge } from '@/lib/format';
import { extractApiError } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useStudents, useDeleteStudent, downloadAdmissionLetter } from './api';
import { StudentForm } from './StudentForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { Student } from '@/types/domain';

export function StudentsPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState<string>('all');
  const [status, setStatus] = useState<string>('active');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const { sort, toggle } = useSort({ sortBy: '', sortOrder: 'asc' });
  const q = useDebounce(search);
  const role = useAuthStore((s) => s.user?.role);
  const academicYearId = useUiStore((s) => s.academicYearId);

  const { data: classes } = useClasses();
  const del = useDeleteStudent();

  const { data, isLoading, isError, refetch } = useStudents({
    q: q || undefined,
    class_id: classId !== 'all' ? Number(classId) : undefined,
    status: status !== 'all' ? status : undefined,
    academicYearId: academicYearId ?? undefined,
    page,
    limit,
    sortBy: sort.sortBy || undefined,
    sortOrder: sort.sortBy ? sort.sortOrder : undefined,
  });

  const canManage = role === 'Admin';

  const onSort = (key: string) => {
    toggle(key);
    setPage(1);
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('students.deleted'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  const handleLetter = async (s: Student) => {
    try {
      await downloadAdmissionLetter(s);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  return (
    <>
      <PageHeader
        title={t('students.title')}
        actions={
          canManage && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('students.admit')}
            </Button>
          )
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('common.search')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="ps-9"
              />
            </div>
            <Select
              value={classId}
              onValueChange={(v) => {
                setClassId(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
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
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="active">{t('common.active')}</SelectItem>
                <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <LoadingRows cols={10} />
          ) : isError ? (
            <ErrorState onRetry={refetch} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sortKey="admissionNo" sort={sort} onSort={onSort}>
                    {t('students.admissionNo')}
                  </SortableTableHead>
                  <TableHead>{t('students.admissionDate')}</TableHead>
                  <SortableTableHead sortKey="fullName" sort={sort} onSort={onSort}>
                    {t('students.fullName')}
                  </SortableTableHead>
                  <SortableTableHead sortKey="fatherName" sort={sort} onSort={onSort}>
                    {t('students.fatherName')}
                  </SortableTableHead>
                  <TableHead>{t('students.age')}</TableHead>
                  <TableHead>{t('students.contactNo')}</TableHead>
                  <SortableTableHead sortKey="class" sort={sort} onSort={onSort}>
                    {t('students.class')}
                  </SortableTableHead>
                  <TableHead>{t('students.category')}</TableHead>
                  <SortableTableHead sortKey="status" sort={sort} onSort={onSort}>
                    {t('common.status')}
                  </SortableTableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.admissionNo}</TableCell>
                    <TableCell>{s.admissionDate ? formatDate(s.admissionDate, i18n.language) : '—'}</TableCell>
                    <TableCell>{s.fullName}</TableCell>
                    <TableCell>{s.fatherName}</TableCell>
                    <TableCell className="whitespace-nowrap">{computeAge(s.dateOfBirth)}</TableCell>
                    <TableCell>{s.contactNo ?? '—'}</TableCell>
                    <TableCell>{s.class?.name ?? s.classId}</TableCell>
                    <TableCell>{s.category?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'active' ? 'success' : 'secondary'}>
                        {t(`common.${s.status === 'active' ? 'active' : 'inactive'}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title={t('students.admissionLetter')} onClick={() => handleLetter(s)}>
                          <FileText className="h-4 w-4" />
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t('common.edit')}
                              onClick={() => openEdit(s)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t('common.delete')}
                              onClick={() => setDeleting(s)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
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

      <StudentForm open={formOpen} onOpenChange={setFormOpen} student={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        title={t('students.confirmDeleteTitle')}
        message={t('students.confirmDelete', { name: deleting?.fullName ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        pending={del.isPending}
      />
    </>
  );
}
