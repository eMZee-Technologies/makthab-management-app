import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field } from '@/components/form/Field';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { roleCreateSchema, type RoleCreateInput } from '@/lib/schemas';
import { extractApiError } from '@/api/client';
import { PERMISSION_CATALOG } from '@makthab/shared';
import { useAddRole, useUpdateRole, type Role } from './api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role | null;
}

export function RoleForm({ open, onOpenChange, role }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = role != null;
  const add = useAddRole();
  const update = useUpdateRole(role?.id ?? 0);
  const mutation = isEdit ? update : add;

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<RoleCreateInput>({
    resolver: zodResolver(roleCreateSchema),
    defaultValues: { name: '', permissions: [] },
  });

  useEffect(() => {
    if (!open) return;
    reset({ name: role?.name ?? '', permissions: role?.permissions ?? [] });
  }, [open, role, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit) await update.mutateAsync(values);
      else await add.mutateAsync(values);
      toast({ title: t(isEdit ? 'roles.updated' : 'roles.created'), variant: 'success' });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  });

  // System roles (Admin/Accountant/Teacher) can't be renamed, but their
  // permissions are still editable — only the name field is locked.
  const nameLocked = isEdit && (role?.isSystem ?? false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'roles.edit' : 'roles.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('roles.name')} error={errors.name?.message} required>
            <Input {...register('name')} disabled={nameLocked} />
          </Field>

          <div className="space-y-2">
            <Label>{t('roles.permissions')}</Label>
            <Controller
              name="permissions"
              control={control}
              render={({ field }) => (
                <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                  {PERMISSION_CATALOG.map((p) => {
                    const checked = field.value?.includes(p.key) ?? false;
                    return (
                      <label key={p.key} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(field.value ?? []);
                            if (e.target.checked) next.add(p.key);
                            else next.delete(p.key);
                            field.onChange(Array.from(next));
                          }}
                        />
                        <span>
                          <span className="font-medium">{p.label}</span>
                          {p.description && (
                            <span className="block text-xs text-muted-foreground">
                              {p.description}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner className="me-2" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
