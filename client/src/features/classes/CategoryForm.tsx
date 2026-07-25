import { useEffect } from 'react';
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
import { Field } from '@/components/form/Field';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { categoryCreateSchema, type CategoryCreateInput } from '@/lib/schemas';
import { useCreateCategory, useUpdateCategory } from '@/api/reference';
import { extractApiError } from '@/api/client';
import type { Category } from '@/types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: Category | null;
}

export function CategoryForm({ open, onOpenChange, category }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = category != null;
  const create = useCreateCategory();
  const update = useUpdateCategory(category?.id ?? 0);
  const mutation = isEdit ? update : create;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CategoryCreateInput>({
    resolver: zodResolver(categoryCreateSchema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (!open) return;
    reset({ name: category?.name ?? '' });
  }, [open, category, reset]);

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: () => {
        toast({ title: t(isEdit ? 'classes.categoryUpdated' : 'classes.categoryCreated'), variant: 'success' });
        reset();
        onOpenChange(false);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'classes.editCategory' : 'classes.addCategory')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label={t('classes.categoryName')} error={errors.name?.message} required>
            <Input {...register('name')} />
          </Field>

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
