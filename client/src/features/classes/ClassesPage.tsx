import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { Pagination, DEFAULT_PAGE_SIZE } from '@/components/Pagination';
import { SortableTableHead, useSort } from '@/components/SortableTableHead';
import { useToast } from '@/components/ui/use-toast';
import { useClasses, useDeleteClass } from '@/api/reference';
import { useStaff } from '@/features/finance/api';
import { extractApiError } from '@/api/client';
import { useCan } from '@/lib/permissions';
import { ClassForm } from './ClassForm';
import { CategoriesTab } from './CategoriesTab';
import type { Class } from '@/types/domain';

export function ClassesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Class | null>(null);
  const can = useCan();

  const { data, isLoading, isError, refetch } = useClasses();
  const { data: staff } = useStaff({ limit: 200 });
  const del = useDeleteClass();

  const canManage = can('classes', 'create') || can('classes', 'update') || can('classes', 'delete');

  const { sort, toggle } = useSort({ sortBy: 'name', sortOrder: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  const teacherName = useMemo(() => {
    const map = new Map((staff?.items ?? []).map((s) => [s.id, s.fullName]));
    return (id?: number | null) => (id != null ? map.get(id) ?? String(id) : '—');
  }, [staff]);

  const sorted = useMemo(() => {
    const rows = [...(data ?? [])];
    const dir = sort.sortOrder === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = sort.sortBy === 'teacher' ? teacherName(a.teacherId) : a.name;
      const bv = sort.sortBy === 'teacher' ? teacherName(b.teacherId) : b.name;
      return av.localeCompare(bv) * dir;
    });
    return rows;
  }, [data, sort, teacherName]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageRows = sorted.slice((page - 1) * limit, page * limit);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (c: Class) => {
    setEditing(c);
    setFormOpen(true);
  };

  const handleDelete = (c: Class) => {
    del.mutate(c.id, {
      onSuccess: () => toast({ title: t('common.delete'), variant: 'success' }),
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  return (
    <>
      <PageHeader title={t('classes.title')} />

      <Tabs defaultValue="classes">
        <TabsList>
          <TabsTrigger value="classes">{t('classes.title')}</TabsTrigger>
          <TabsTrigger value="categories">{t('classes.categories')}</TabsTrigger>
        </TabsList>

        <TabsContent value="classes" className="space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('classes.add')}
              </Button>
            </div>
          )}

          <Card>
            <CardContent className="space-y-4 pt-6">
              {isLoading ? (
                <LoadingRows cols={4} />
              ) : isError ? (
                <ErrorState onRetry={refetch} />
              ) : !data || data.length === 0 ? (
                <EmptyState />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead sortKey="name" sort={sort} onSort={toggle}>
                        {t('classes.name')}
                      </SortableTableHead>
                      <SortableTableHead sortKey="teacher" sort={sort} onSort={toggle}>
                        {t('classes.teacher')}
                      </SortableTableHead>
                      <TableHead>{t('classes.categories')}</TableHead>
                      <TableHead className="text-end">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{teacherName(c.teacherId)}</TableCell>
                        <TableCell>
                          {c.categories.length > 0
                            ? c.categories.map((cat) => cat.name).join(', ')
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {canManage && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={t('common.edit')}
                                  onClick={() => openEdit(c)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={t('common.delete')}
                                  onClick={() => handleDelete(c)}
                                  disabled={del.isPending}
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
              {data && data.length > 0 && (
                <Pagination
                  page={page}
                  limit={limit}
                  total={total}
                  onPageChange={setPage}
                  onLimitChange={(l) => {
                    setLimit(l);
                    setPage(1);
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
      </Tabs>

      <ClassForm open={formOpen} onOpenChange={setFormOpen} classItem={editing} />
    </>
  );
}
