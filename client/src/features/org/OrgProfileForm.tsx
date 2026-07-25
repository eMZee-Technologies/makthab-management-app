import { useEffect, useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
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
import { useQueryClient } from '@tanstack/react-query';
import { orgProfileCreateSchema, type OrgProfileCreateInput } from '@/lib/schemas';
import { api, extractApiError } from '@/api/client';
import { useAddOrgProfile, useUpdateOrgProfile, useOrgImageUrl } from './api';
import type { OrgProfile } from '@/types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: OrgProfile | null;
}

export function OrgProfileForm({ open, onOpenChange, profile }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = profile != null;
  const add = useAddOrgProfile();
  const update = useUpdateOrgProfile(profile?.id ?? 0);
  const mutation = isEdit ? update : add;

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const existingUrl = useOrgImageUrl(profile?.id, profile?.headerImagePath);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OrgProfileCreateInput>({
    resolver: zodResolver(orgProfileCreateSchema),
    defaultValues: { name: '', address: '' },
  });

  useEffect(() => {
    if (!open) return;
    setImageFile(null);
    setPreviewUrl(null);
    reset({ name: profile?.name ?? '', address: profile?.address ?? '' });
  }, [open, profile, reset]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  const shownImage = previewUrl ?? existingUrl;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = isEdit
        ? await update.mutateAsync(values)
        : await add.mutateAsync(values);
      if (imageFile && saved.id) {
        setUploading(true);
        const form = new FormData();
        form.append('image', imageFile);
        await api.post(`/org-profile/${saved.id}/image`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        qc.invalidateQueries({ queryKey: ['org-profile'] });
      }
      toast({ title: t(isEdit ? 'org.updated' : 'org.created'), variant: 'success' });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'org.edit' : 'org.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('org.name')} error={errors.name?.message} required>
            <Input {...register('name')} />
          </Field>
          <Field label={t('org.address')} error={errors.address?.message} required>
            <Input {...register('address')} />
          </Field>

          <div className="space-y-1.5">
            <Label>{t('org.headerImage')}</Label>
            <div className="flex items-center gap-4">
              {shownImage ? (
                <img
                  src={shownImage}
                  alt=""
                  className="h-16 w-28 rounded-md border object-cover"
                />
              ) : (
                <div className="flex h-16 w-28 items-center justify-center rounded-md border bg-muted text-center text-xs text-muted-foreground">
                  {t('org.headerImage')}
                </div>
              )}
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onImageChange}
                className="max-w-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('org.headerImageHint')}</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || uploading}>
              {(mutation.isPending || uploading) && <Spinner className="me-2" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
