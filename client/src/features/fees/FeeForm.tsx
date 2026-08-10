import { useEffect, useMemo } from 'react';
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
import { CurrencyInput } from '@/components/form/CurrencyInput';
import { Field } from '@/components/form/Field';
import { SelectField } from '@/components/form/SelectField';
import { AutocompleteField } from '@/components/form/AutocompleteField';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { feePaymentCreateSchema, type FeePaymentCreateInput } from '@/lib/schemas';
import { useStudentOptions } from '@/features/students/useStudentOptions';
import { toDateInput, monthName } from '@/lib/format';
import { extractApiError } from '@/api/client';
import { useRecordPayment, useUpdateFee } from './api';
import type { FeePayment } from '@/types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetStudentId?: number;
  /** Prefill fee type when collecting from Monthly / Admission tabs. */
  defaultFeeType?: 'monthly' | 'admission' | 'annual' | 'other';
  fee?: FeePayment | null;
}

const FEE_TYPES = ['admission', 'monthly', 'annual', 'other'] as const;
const METHODS = ['cash', 'upi', 'bank', 'cheque', 'card'] as const;

export function FeeForm({ open, onOpenChange, presetStudentId, defaultFeeType = 'monthly', fee }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = fee != null;
  const record = useRecordPayment();
  const update = useUpdateFee(fee?.id ?? 0);
  const mutation = isEdit ? update : record;
  const { options: baseStudentOptions } = useStudentOptions();
  // useStudentOptions only loads active students (first 200). When editing a
  // fee whose student fell outside that set — inactive/graduated, or simply
  // beyond the page — the Autocomplete would have nothing to pre-select
  // against, so make sure the fee's own student is always present.
  const studentOptions = useMemo(() => {
    if (!fee?.student || baseStudentOptions.some((o) => o.value === fee.student!.id)) {
      return baseStudentOptions;
    }
    return [
      { value: fee.student.id, label: `${fee.student.admissionNo} — ${fee.student.fullName}` },
      ...baseStudentOptions,
    ];
  }, [baseStudentOptions, fee]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<FeePaymentCreateInput>({
    resolver: zodResolver(feePaymentCreateSchema),
    defaultValues: {
      studentId: presetStudentId,
      feeType: defaultFeeType,
      feeYear: new Date().getFullYear(),
      paymentMethod: 'cash',
      paymentDate: toDateInput(new Date()),
      waiverAmount: 0,
    } as Partial<FeePaymentCreateInput> as FeePaymentCreateInput,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      fee
        ? ({
            studentId: fee.studentId,
            feeType: fee.feeType,
            feeMonth: fee.feeMonth ?? undefined,
            feeYear: fee.feeYear,
            amountDue: fee.amountDue,
            amountPaid: fee.amountPaid,
            waiverAmount: fee.waiverAmount,
            paymentDate: fee.paymentDate.slice(0, 10),
            paymentMethod: fee.paymentMethod,
          } as unknown as FeePaymentCreateInput)
        : ({
            studentId: presetStudentId,
            feeType: defaultFeeType,
            feeYear: new Date().getFullYear(),
            paymentMethod: 'cash',
            paymentDate: toDateInput(new Date()),
            waiverAmount: 0,
          } as Partial<FeePaymentCreateInput> as FeePaymentCreateInput),
    );
  }, [open, fee, presetStudentId, defaultFeeType, reset]);

  const feeType = watch('feeType');

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: () => {
        toast({ title: t(isEdit ? 'fees.updated' : 'fees.created'), variant: 'success' });
        reset();
        onOpenChange(false);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'fees.edit' : 'fees.collect')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <AutocompleteField
              name="studentId"
              control={control}
              label={t('fees.student')}
              error={errors.studentId?.message}
              required
              placeholder={t('common.searchStudent')}
              options={studentOptions}
            />
          </div>
          {feeType === 'monthly' && (
            <SelectField
              name="feeMonth"
              control={control}
              label={t('fees.month')}
              error={errors.feeMonth?.message}
              options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) }))}
            />
          )}
          <Field label={t('fees.year')} error={errors.feeYear?.message} required>
            <Input type="number" {...register('feeYear')} />
          </Field>
          <SelectField
            name="feeType"
            control={control}
            label={t('fees.feeType')}
            error={errors.feeType?.message}
            required
            options={FEE_TYPES.map((v) => ({ value: v, label: v }))}
          />
          <Field label={t('fees.amountDue')} error={errors.amountDue?.message} required>
            <CurrencyInput step="0.01" {...register('amountDue')} />
          </Field>
          <Field label={t('fees.amountPaid')} error={errors.amountPaid?.message} required>
            <CurrencyInput step="0.01" {...register('amountPaid')} />
          </Field>
          <Field label={t('fees.waiver')} error={errors.waiverAmount?.message}>
            <CurrencyInput step="0.01" {...register('waiverAmount')} />
          </Field>
          <Field label={t('fees.paymentDate')} error={errors.paymentDate?.message} required>
            <Input type="date" {...register('paymentDate')} />
          </Field>
          <SelectField
            name="paymentMethod"
            control={control}
            label={t('fees.paymentMethod')}
            error={errors.paymentMethod?.message}
            required
            options={METHODS.map((v) => ({ value: v, label: v }))}
          />

          <DialogFooter className="sm:col-span-2">
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
