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
import { SelectField } from '@/components/form/SelectField';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { classCreateSchema, type ClassCreateInput } from '@/lib/schemas';
import { useCategories, useCreateClass, useUpdateClass } from '@/api/reference';
import { useStaff } from '@/features/finance/api';
import { extractApiError } from '@/api/client';
import type { Class } from '@/types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classItem?: Class | null;
}

export function ClassForm({ open, onOpenChange, classItem }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = classItem != null;
  const create = useCreateClass();
  const update = useUpdateClass(classItem?.id ?? 0);
  const mutation = isEdit ? update : create;
  const { data: staff } = useStaff({ limit: 200 });
  const { data: categories } = useCategories();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ClassCreateInput>({
    resolver: zodResolver(classCreateSchema),
    defaultValues: { name: '', categoryIds: [] } as ClassCreateInput,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      classItem
        ? {
            name: classItem.name,
            teacherId: classItem.teacherId ?? undefined,
            categoryIds: classItem.categories.map((c) => c.id),
          }
        : { name: '', teacherId: undefined, categoryIds: [] },
    );
  }, [open, classItem, reset]);

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: () => {
        toast({ title: t(isEdit ? 'classes.updated' : 'classes.created'), variant: 'success' });
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
          <DialogTitle>{t(isEdit ? 'classes.edit' : 'classes.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label={t('classes.name')} error={errors.name?.message} required>
            <Input {...register('name')} />
          </Field>
          <SelectField
            name="teacherId"
            control={control}
            label={t('classes.teacher')}
            error={errors.teacherId?.message}
            placeholder="—"
            options={(staff?.items ?? [])
              .filter((s) => s.role === 'Teacher')
              .map((s) => ({ value: s.id, label: s.fullName }))}
          />

          <div className="space-y-2">
            <Label>{t('classes.categories')}</Label>
            <Controller
              name="categoryIds"
              control={control}
              render={({ field }) => (
                <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  {(categories ?? []).length === 0 && (
                    <p className="col-span-full text-sm text-muted-foreground">
                      {t('classes.noCategories')}
                    </p>
                  )}
                  {(categories ?? []).map((c) => {
                    const checked = field.value?.includes(c.id) ?? false;
                    return (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input accent-primary"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(field.value ?? []);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            field.onChange(Array.from(next));
                          }}
                        />
                        {c.name}
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
