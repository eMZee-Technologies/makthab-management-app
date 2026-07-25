import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
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
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { extractApiError } from '@/api/client';
import { useRoles, useDeleteRole, type Role } from './api';
import { RoleForm } from './RoleForm';

export function RolesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const { data, isLoading, isError, refetch } = useRoles();
  const del = useDeleteRole();

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (r: Role) => {
    setEditing(r);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('roles.deleted'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  return (
    <>
      <PageHeader
        title={t('roles.title')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('roles.add')}
          </Button>
        }
      />

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
                  <TableHead>{t('roles.name')}</TableHead>
                  <TableHead>{t('roles.permissions')}</TableHead>
                  <TableHead className="w-24">{t('common.status')}</TableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {r.permissions.length}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.isSystem && (
                        <Badge variant="secondary" title={t('roles.systemHint')}>
                          <Lock className="me-1 h-3 w-3" />
                          {t('roles.system')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('common.edit')}
                          onClick={() => openEdit(r)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!r.isSystem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('common.delete')}
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RoleForm open={formOpen} onOpenChange={setFormOpen} role={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        title={t('roles.confirmDeleteTitle')}
        message={t('roles.confirmDelete', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        pending={del.isPending}
      />
    </>
  );
}
