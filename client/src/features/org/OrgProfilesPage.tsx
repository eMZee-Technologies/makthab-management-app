import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
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
import { useCan } from '@/lib/permissions';
import {
  useOrgProfiles,
  useDeleteOrgProfile,
  useSetActiveOrgProfile,
  useOrgImageUrl,
} from './api';
import { OrgProfileForm } from './OrgProfileForm';
import type { OrgProfile } from '@/types/domain';

function OrgThumb({ profile }: { profile: OrgProfile }) {
  const url = useOrgImageUrl(profile.id, profile.headerImagePath);
  if (!url) {
    return <div className="h-9 w-16 rounded border bg-muted" />;
  }
  return <img src={url} alt="" className="h-9 w-16 rounded border object-cover" />;
}

export function OrgProfilesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  // Organisation resource only exposes view + update in the matrix.
  const can = useCan();
  const canUpdate = can('organisation', 'update');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OrgProfile | null>(null);
  const [deleting, setDeleting] = useState<OrgProfile | null>(null);

  const { data, isLoading, isError, refetch } = useOrgProfiles();
  const del = useDeleteOrgProfile();
  const setActive = useSetActiveOrgProfile();

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (p: OrgProfile) => {
    setEditing(p);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('org.deleted'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  const handleSetActive = (p: OrgProfile) => {
    setActive.mutate(p.id, {
      onSuccess: () => toast({ title: t('org.activated'), variant: 'success' }),
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  return (
    <>
      <PageHeader
        title={t('org.title')}
        actions={
          canUpdate && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('org.add')}
            </Button>
          )
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          {isLoading ? (
            <LoadingRows cols={5} />
          ) : isError ? (
            <ErrorState onRetry={refetch} />
          ) : !data || data.length === 0 ? (
            <EmptyState />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t('org.headerImage')}</TableHead>
                  <TableHead>{t('org.name')}</TableHead>
                  <TableHead>{t('org.address')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  {canUpdate && <TableHead className="text-end">{t('common.actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <OrgThumb profile={p} />
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.address}</TableCell>
                    <TableCell>
                      {p.isActive ? (
                        <Badge variant="success">{t('org.active')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('common.inactive')}</Badge>
                      )}
                    </TableCell>
                    {canUpdate && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {!p.isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('org.setActive')}
                            onClick={() => handleSetActive(p)}
                            disabled={setActive.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('common.edit')}
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('common.delete')}
                          onClick={() => setDeleting(p)}
                          disabled={p.isActive}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <OrgProfileForm open={formOpen} onOpenChange={setFormOpen} profile={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        title={t('org.confirmDeleteTitle')}
        message={t('org.confirmDelete', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        pending={del.isPending}
      />
    </>
  );
}
