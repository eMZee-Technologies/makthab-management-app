import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, KeyRound, UserX, UserCheck, Check, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
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
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { api, extractApiError } from '@/api/client';
import { useUsers, useDeleteUser, useReactivateUser, useApproveUser, useRejectUser } from './api';
import { useRoles } from '../roles/api';
import { UserForm } from './UserForm';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import type { User } from '@/types/domain';

function initials(name?: string) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Photos live on the linked staff record and need an authed blob fetch
// (a plain <img src> can't send the Bearer token), so resolve to an object URL.
function UserAvatar({ user }: { user: User }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!user.photoPath || !user.staffId) return;
    let active = true;
    let objectUrl: string | null = null;
    api
      .get(`/staff/${user.staffId}/photo`, { responseType: 'blob' })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* no photo — fall back to initials */
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user.photoPath, user.staffId]);

  return (
    <Avatar>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
    </Avatar>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const [role, setRole] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const { sort, toggle } = useSort({ sortBy: '', sortOrder: 'asc' });

  const del = useDeleteUser();
  const reactivate = useReactivateUser();
  const approve = useApproveUser();
  const reject = useRejectUser();
  const { data: roles } = useRoles();

  const { data, isLoading, isError, refetch } = useUsers({
    role: role !== 'all' ? role : undefined,
    status: status !== 'all' ? status : undefined,
    page,
    limit,
    sortBy: sort.sortBy || undefined,
    sortOrder: sort.sortBy ? sort.sortOrder : undefined,
  });

  const onSort = (key: string) => {
    toggle(key);
    setPage(1);
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setFormOpen(true);
  };

  const confirmDeactivate = () => {
    if (!deactivating) return;
    del.mutate(deactivating.id, {
      onSuccess: () => {
        toast({ title: t('users.deactivated'), variant: 'success' });
        setDeactivating(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  const handleReactivate = (u: User) => {
    reactivate.mutate(u.id, {
      onSuccess: () => toast({ title: t('users.reactivated'), variant: 'success' }),
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  const handleApprove = (u: User) => {
    approve.mutate(
      { id: u.id },
      {
        onSuccess: () => toast({ title: t('users.approved'), variant: 'success' }),
        onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
      }
    );
  };

  const handleReject = (u: User) => {
    const reason = window.prompt(t('users.rejectReason'));
    if (!reason) return;
    reject.mutate(
      { id: u.id, reason },
      {
        onSuccess: () => toast({ title: t('users.rejected'), variant: 'success' }),
        onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
      }
    );
  };

  return (
    <>
      <PageHeader
        title={t('users.title')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('users.add')}
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {(roles ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.name}>
                    {r.name}
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
                <SelectItem value="pending_approval">{t('users.pendingApproval')}</SelectItem>
                <SelectItem value="pending_verification">{t('users.pendingVerification')}</SelectItem>
                <SelectItem value="rejected">{t('users.rejectedStatus')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <LoadingRows cols={7} />
          ) : isError ? (
            <ErrorState onRetry={refetch} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">{t('users.photo')}</TableHead>
                  <SortableTableHead sortKey="fullName" sort={sort} onSort={onSort}>
                    {t('users.fullName')}
                  </SortableTableHead>
                  <SortableTableHead sortKey="username" sort={sort} onSort={onSort}>
                    {t('users.username')}
                  </SortableTableHead>
                  <SortableTableHead sortKey="email" sort={sort} onSort={onSort}>
                    {t('users.email')}
                  </SortableTableHead>
                  <SortableTableHead sortKey="role" sort={sort} onSort={onSort}>
                    {t('users.role')}
                  </SortableTableHead>
                  <TableHead>{t('users.contactNo')}</TableHead>
                  <SortableTableHead sortKey="status" sort={sort} onSort={onSort}>
                    {t('common.status')}
                  </SortableTableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <UserAvatar user={u} />
                    </TableCell>
                    <TableCell className="font-medium">{u.fullName}</TableCell>
                    <TableCell>{u.username}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{u.role}</Badge>
                    </TableCell>
                    <TableCell>{u.contactNo ?? '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          u.status === 'active'
                            ? 'success'
                            : u.status === 'pending_approval'
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {u.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {u.status === 'pending_approval' && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t('users.approve')}
                              onClick={() => handleApprove(u)}
                            >
                              <Check className="h-4 w-4 text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t('users.reject')}
                              onClick={() => handleReject(u)}
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('common.edit')}
                          onClick={() => openEdit(u)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('users.resetPassword')}
                          onClick={() => setResetting(u)}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        {u.status === 'active' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('users.deactivate')}
                            onClick={() => setDeactivating(u)}
                          >
                            <UserX className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : u.status === 'inactive' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('users.reactivate')}
                            onClick={() => handleReactivate(u)}
                          >
                            <UserCheck className="h-4 w-4 text-primary" />
                          </Button>
                        ) : null}
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

      <UserForm open={formOpen} onOpenChange={setFormOpen} user={editing} />

      <ResetPasswordDialog
        open={resetting !== null}
        onOpenChange={(open) => {
          if (!open) setResetting(null);
        }}
        user={resetting}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        onConfirm={confirmDeactivate}
        title={t('users.confirmDeactivateTitle')}
        message={t('users.confirmDeactivate', { name: deactivating?.fullName ?? '' })}
        confirmLabel={t('users.deactivate')}
        destructive
        pending={del.isPending}
      />
    </>
  );
}
