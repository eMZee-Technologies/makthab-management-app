import { useEffect, useState, type ChangeEvent } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
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
import { SelectField } from '@/components/form/SelectField';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import {
  userCreateSchema,
  userUpdateSchema,
  type UserCreateInput,
} from '@/lib/schemas';
import { api, extractApiError } from '@/api/client';
import { useAddUser, useUpdateUser } from './api';
import { useRoles } from '../roles/api';
import { useUploadStaffPhoto, useUploadStaffSignature } from '../finance/api';
import type { User } from '@/types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
}

export function UserForm({ open, onOpenChange, user }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = user != null;
  const add = useAddUser();
  const update = useUpdateUser(user?.id ?? 0);
  const uploadPhoto = useUploadStaffPhoto();
  const uploadSignature = useUploadStaffSignature();
  const mutation = isEdit ? update : add;
  const { data: roles } = useRoles();

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<UserCreateInput>({
    resolver: zodResolver(isEdit ? userUpdateSchema : userCreateSchema),
    defaultValues: { status: 'active' } as Partial<UserCreateInput> as UserCreateInput,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      user
        ? ({
            fullName: user.fullName,
            username: user.username,
            email: user.email,
            role: user.role as UserCreateInput['role'],
            contactNo: user.contactNo,
            whatsappNo: user.whatsappNo,
            address: user.address ?? undefined,
            status: user.status === 'inactive' ? 'inactive' : 'active',
          } as UserCreateInput)
        : ({ status: 'active' } as Partial<UserCreateInput> as UserCreateInput),
    );
  }, [open, user, reset]);

  // Load an existing user's photo for the preview. Photos live on the linked
  // staff record, so we fetch the shared /staff/:staffId/photo endpoint (authed
  // blob fetch — a plain <img src> can't send the Bearer token).
  useEffect(() => {
    if (!open) return;
    setPhotoFile(null);
    setPreviewUrl(null);
    if (!user?.photoPath || !user.staffId) return;
    let active = true;
    api
      .get(`/staff/${user.staffId}/photo`, { responseType: 'blob' })
      .then((res) => {
        if (active) setPreviewUrl(URL.createObjectURL(res.data as Blob));
      })
      .catch(() => {
        /* no photo / not found — leave preview empty */
      });
    return () => {
      active = false;
    };
  }, [open, user]);

  // Revoke the previous object URL whenever the preview changes or on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Signatures live on the same linked staff record as photos (same authed-
  // blob-fetch reason — a plain <img src> can't send the Bearer token).
  useEffect(() => {
    if (!open) return;
    setSignatureFile(null);
    setSignaturePreviewUrl(null);
    if (!user?.signaturePath || !user.staffId) return;
    let active = true;
    api
      .get(`/staff/${user.staffId}/signature`, { responseType: 'blob' })
      .then((res) => {
        if (active) setSignaturePreviewUrl(URL.createObjectURL(res.data as Blob));
      })
      .catch(() => {
        /* no signature / not found — leave preview empty */
      });
    return () => {
      active = false;
    };
  }, [open, user]);

  useEffect(() => {
    return () => {
      if (signaturePreviewUrl) URL.revokeObjectURL(signaturePreviewUrl);
    };
  }, [signaturePreviewUrl]);

  function onPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function onSignatureChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setSignatureFile(file);
    setSignaturePreviewUrl(URL.createObjectURL(file));
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = isEdit
        ? await update.mutateAsync(values)
        : await add.mutateAsync(values);
      if (photoFile && saved.staffId) {
        await uploadPhoto.mutateAsync({ id: saved.staffId, file: photoFile });
      }
      if (signatureFile && saved.staffId) {
        await uploadSignature.mutateAsync({ id: saved.staffId, file: signatureFile });
      }
      if ((photoFile || signatureFile) && saved.staffId) {
        qc.invalidateQueries({ queryKey: ['users'] });
      }
      toast({ title: t(isEdit ? 'users.updated' : 'users.created'), variant: 'success' });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'users.edit' : 'users.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="flex items-start justify-between gap-4 sm:col-span-2">
            <div className="flex items-center gap-4">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  className="h-16 w-16 rounded-md border object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted text-center text-xs text-muted-foreground">
                  {t('users.photo')}
                </div>
              )}
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onPhotoChange}
                className="max-w-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <input
                    id="user-status"
                    type="checkbox"
                    className="h-4 w-4 rounded border-input accent-primary"
                    checked={field.value !== 'inactive'}
                    onChange={(e) => field.onChange(e.target.checked ? 'active' : 'inactive')}
                  />
                )}
              />
              <Label htmlFor="user-status">{t('common.active')}</Label>
            </div>
          </div>

          <Field label={t('users.fullName')} error={errors.fullName?.message} required>
            <Input {...register('fullName')} />
          </Field>
          <Field label={t('users.username')} error={errors.username?.message} required>
            <Input {...register('username')} disabled={isEdit} readOnly={isEdit} />
          </Field>
          {!isEdit && (
            <Field label={t('users.password')} error={errors.password?.message} required>
              <Input type="password" autoComplete="new-password" {...register('password')} />
            </Field>
          )}
          <SelectField
            name="role"
            control={control}
            label={t('users.role')}
            error={errors.role?.message}
            required
            options={(roles ?? []).map((r) => ({ value: r.name, label: r.name }))}
          />
          <Field label={t('users.email')} error={errors.email?.message} required>
            <Input type="email" {...register('email')} />
          </Field>
          <Field label={t('users.contactNo')} error={errors.contactNo?.message} required>
            <Input {...register('contactNo')} />
          </Field>
          <Field label={t('users.whatsappNo')} error={errors.whatsappNo?.message} required>
            <Input {...register('whatsappNo')} />
          </Field>
          <Field label={t('users.address')} error={errors.address?.message} className="sm:col-span-2">
            <Input {...register('address')} />
          </Field>

          <div className="flex items-center gap-4 sm:col-span-2">
            {signaturePreviewUrl ? (
              <img
                src={signaturePreviewUrl}
                alt=""
                className="h-12 w-28 rounded-md border object-contain bg-white"
              />
            ) : (
              <div className="flex h-12 w-28 items-center justify-center rounded-md border bg-muted text-center text-xs text-muted-foreground">
                {t('users.signature')}
              </div>
            )}
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">{t('users.signature')}</Label>
              <Input type="file" accept="image/jpeg" onChange={onSignatureChange} className="max-w-xs" />
            </div>
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || uploadPhoto.isPending || uploadSignature.isPending}>
              {(mutation.isPending || uploadPhoto.isPending || uploadSignature.isPending) && <Spinner className="me-2" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
