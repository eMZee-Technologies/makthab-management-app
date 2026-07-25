import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/form/CurrencyInput';
import { Field } from '@/components/form/Field';
import { SelectField } from '@/components/form/SelectField';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/format';
import { extractApiError } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useClasses, useAcademicYears } from '@/api/reference';
import { feeStructureCreateSchema, type FeeStructureCreateInput } from '@/lib/schemas';
import { useFeeStructures, useSaveFeeStructure, useDeleteFeeStructure } from './api';
import type { FeeStructure } from '@/types/domain';

const FEE_TYPES = ['admission', 'monthly', 'annual', 'other'] as const;

export function FeeStructures() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role === 'Admin' || role === 'Accountant';
  const { data: classes = [] } = useClasses();
  const { data: years = [] } = useAcademicYears();
  const { data: structures, isLoading, isError, refetch } = useFeeStructures();
  const save = useSaveFeeStructure();
  const del = useDeleteFeeStructure();
  const [deleting, setDeleting] = useState<FeeStructure | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FeeStructureCreateInput>({
    resolver: zodResolver(feeStructureCreateSchema),
    defaultValues: { feeType: 'monthly' } as Partial<FeeStructureCreateInput> as FeeStructureCreateInput,
  });

  const classId = watch('classId');
  const categoryOptions = (classes.find((c) => c.id === Number(classId))?.categories ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  // A category from a previously-selected class is never valid once the
  // class changes, so drop it back to "class-wide" (undefined) instead of
  // silently keeping a stale id.
  const prevClassId = useRef<number | string | undefined>(classId);
  useEffect(() => {
    if (prevClassId.current !== classId) {
      prevClassId.current = classId;
      setValue('categoryId', undefined);
    }
  }, [classId, setValue]);

  const classNameFor = (id: number) => classes.find((c) => c.id === id)?.name ?? id;
  const categoryNameFor = (s: FeeStructure) => s.category?.name ?? t('fees.classWide');

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('fees.structureDeleted'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  const onSubmit = handleSubmit((values) => {
    save.mutate(values, {
      onSuccess: () => {
        toast({ title: t('common.save'), variant: 'success' });
        reset({ feeType: 'monthly' } as Partial<FeeStructureCreateInput> as FeeStructureCreateInput);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  });

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-4">
          <SelectField
            name="classId"
            control={control}
            label={t('students.class')}
            error={errors.classId?.message}
            required
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectField
            name="categoryId"
            control={control}
            label={t('fees.category')}
            error={errors.categoryId?.message}
            placeholder={t('fees.classWide')}
            options={categoryOptions}
          />
          <SelectField
            name="academicYearId"
            control={control}
            label={t('common.academicYear')}
            error={errors.academicYearId?.message}
            required
            options={years.map((y) => ({ value: y.id, label: y.name }))}
          />
          <SelectField
            name="feeType"
            control={control}
            label={t('fees.feeType')}
            error={errors.feeType?.message}
            required
            options={FEE_TYPES.map((v) => ({ value: v, label: v }))}
          />
          <Field label={t('fees.amountDue')} error={errors.amount?.message} required>
            <CurrencyInput step="0.01" {...register('amount')} />
          </Field>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner className="me-2" />}
              {t('common.save')}
            </Button>
          </div>
        </form>

        {isLoading ? (
          <LoadingRows cols={5} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : !structures || structures.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('students.class')}</TableHead>
                <TableHead>{t('fees.category')}</TableHead>
                <TableHead>{t('fees.feeType')}</TableHead>
                <TableHead className="text-end">{t('fees.amountDue')}</TableHead>
                {canManage && <TableHead className="text-end">{t('common.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {structures.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{classNameFor(s.classId)}</TableCell>
                  <TableCell>{categoryNameFor(s)}</TableCell>
                  <TableCell className="capitalize">{s.feeType}</TableCell>
                  <TableCell className="text-end">{formatCurrency(s.amount, i18n.language)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('common.delete')}
                          onClick={() => setDeleting(s)}
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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        title={t('fees.confirmDeleteStructureTitle')}
        message={t('fees.confirmDeleteStructure', {
          feeType: deleting?.feeType ?? '',
          class: deleting ? classNameFor(deleting.classId) : '',
        })}
        confirmLabel={t('common.delete')}
        destructive
        pending={del.isPending}
      />
    </Card>
  );
}
