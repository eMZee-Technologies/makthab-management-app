import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/form/Field';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { extractApiError } from '@/api/client';
import {
  adminBaselineMatrix,
  clearAllResourceMatrix,
  effectiveResourceMatrix,
  normalizeRolePermissions,
  selectAllResourceMatrix,
  setResourceAction,
  type Action,
  type ResourceActions,
  type ResourceKey,
  type RolePermissionsMatrix,
} from '@makthab/shared';
import { useAddRole, useUpdateRole, type Role, type RoleWriteInput } from './api';
import { PermissionMatrix } from './PermissionMatrix';

const nameSchema = z.object({
  name: z.string().trim().min(1, 'Required'),
});
type NameForm = z.infer<typeof nameSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role | null;
}

function matrixStateFromRole(role?: Role | null): {
  inheritsFromAdmin: boolean;
  resources: Record<ResourceKey, ResourceActions>;
} {
  if (!role) {
    return { inheritsFromAdmin: true, resources: adminBaselineMatrix() };
  }
  if (role.isFullAccess || role.permissionMatrix.mode === 'all') {
    return { inheritsFromAdmin: false, resources: adminBaselineMatrix() };
  }
  return {
    inheritsFromAdmin: role.permissionMatrix.inheritsFromAdmin,
    resources: effectiveResourceMatrix(role.permissionMatrix),
  };
}

export function RoleForm({ open, onOpenChange, role }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = role != null;
  const add = useAddRole();
  const update = useUpdateRole(role?.id ?? 0);
  const mutation = isEdit ? update : add;

  const nameLocked = isEdit && (role?.isSystem ?? false);
  const permissionsLocked = isEdit && (role?.isFullAccess ?? false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  });

  const [inheritsFromAdmin, setInheritsFromAdmin] = useState(true);
  const [resources, setResources] = useState<Record<ResourceKey, ResourceActions>>(
    () => adminBaselineMatrix(),
  );

  useEffect(() => {
    if (!open) return;
    reset({ name: role?.name ?? '' });
    const next = matrixStateFromRole(role);
    setInheritsFromAdmin(next.inheritsFromAdmin);
    setResources(next.resources);
  }, [open, role, reset]);

  const buildMatrix = (): RolePermissionsMatrix =>
    normalizeRolePermissions({
      mode: 'matrix',
      inheritsFromAdmin,
      resources,
    }) as RolePermissionsMatrix;

  const onSubmit = handleSubmit(async ({ name }) => {
    try {
      if (isEdit && permissionsLocked) {
        onOpenChange(false);
        return;
      }
      const body: RoleWriteInput = {
        name,
        ...(permissionsLocked
          ? {}
          : { permissionMatrix: buildMatrix(), inheritsFromAdmin }),
      };
      if (isEdit) await update.mutateAsync(body);
      else await add.mutateAsync(body);
      toast({ title: t(isEdit ? 'roles.updated' : 'roles.created'), variant: 'success' });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'roles.edit' : 'roles.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('roles.name')} error={errors.name?.message} required>
            <Input {...register('name')} disabled={nameLocked} />
          </Field>

          <PermissionMatrix
            resources={resources}
            inheritsFromAdmin={inheritsFromAdmin}
            isFullAccess={role?.isFullAccess ?? false}
            readOnly={permissionsLocked}
            onToggleCell={(resource: ResourceKey, action: Action, value: boolean) => {
              setResources((prev) => setResourceAction(prev, resource, action, value));
            }}
            onInheritChange={(inherits) => {
              setInheritsFromAdmin(inherits);
              if (inherits) setResources(adminBaselineMatrix());
            }}
            onSelectAll={() => setResources(selectAllResourceMatrix())}
            onClearAll={() => setResources(clearAllResourceMatrix())}
            onResetBaseline={() => {
              setInheritsFromAdmin(true);
              setResources(adminBaselineMatrix());
            }}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            {!(permissionsLocked && nameLocked) && (
              <Button type="submit" disabled={mutation.isPending || (permissionsLocked && nameLocked)}>
                {mutation.isPending && <Spinner className="me-2" />}
                {t('common.save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
