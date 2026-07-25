import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { useCategories, useDeleteCategory } from '@/api/reference';
import { extractApiError } from '@/api/client';
import { CategoryForm } from './CategoryForm';
import type { Category } from '@/types/domain';

// The global category master list a class picks from (e.g. Noorani Qaida,
// Naazira Quran, Hifz Quran). Lives as a tab within Classes, mirroring how
// Fee Structures is a tab within Fees rather than its own nav entry.
export function CategoriesTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const { data, isLoading, isError, refetch } = useCategories();
  const del = useDeleteCategory();

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('common.delete'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t('classes.addCategory')}
        </Button>
      </div>

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
                  <TableHead>{t('classes.categoryName')}</TableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
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
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CategoryForm open={formOpen} onOpenChange={setFormOpen} category={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        title={t('classes.confirmDeleteCategoryTitle')}
        message={t('classes.confirmDeleteCategory', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        pending={del.isPending}
      />
    </div>
  );
}
