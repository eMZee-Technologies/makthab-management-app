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
import { CurrencyInput } from '@/components/form/CurrencyInput';
import { Field } from '@/components/form/Field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { contributionCreateSchema, type ContributionCreateInput } from '@/lib/schemas';
import { toDateInput } from '@/lib/format';
import { extractApiError } from '@/api/client';
import { useCreateContribution, useUpdateContribution } from './api';
import type { Contribution } from '@/types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contribution?: Contribution | null;
}

const ANONYMOUS_NAME = 'Anonymous';

export function ContributionForm({ open, onOpenChange, contribution }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = contribution != null;
  const create = useCreateContribution();
  const update = useUpdateContribution(contribution?.id ?? 0);
  const mutation = isEdit ? update : create;

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ContributionCreateInput>({
    resolver: zodResolver(contributionCreateSchema),
    defaultValues: {
      contributorType: 'individual',
      contributorName: '',
      date: toDateInput(new Date()),
      amount: undefined as unknown as number,
      notes: undefined,
      whatsappNo: undefined,
    },
  });

  const contributorType = watch('contributorType');

  useEffect(() => {
    if (!open) return;
    reset(
      contribution
        ? {
            amount: contribution.amount,
            contributorName: contribution.contributorName,
            contributorType: contribution.contributorType,
            date: contribution.date.slice(0, 10),
            notes: contribution.notes ?? undefined,
            whatsappNo: contribution.whatsappNo ?? undefined,
          }
        : {
            contributorType: 'individual',
            contributorName: '',
            date: toDateInput(new Date()),
            amount: undefined as unknown as number,
            notes: undefined,
            whatsappNo: undefined,
          },
    );
  }, [open, contribution, reset]);

  useEffect(() => {
    if (contributorType === 'anonymous') {
      setValue('contributorName', ANONYMOUS_NAME);
    }
  }, [contributorType, setValue]);

  const onSubmit = handleSubmit((values) => {
    const payload: ContributionCreateInput = {
      ...values,
      contributorName:
        values.contributorType === 'anonymous' ? ANONYMOUS_NAME : values.contributorName,
    };
    mutation.mutate(payload, {
      onSuccess: () => {
        toast({
          title: t(isEdit ? 'fees.contributionUpdated' : 'fees.contributionCreated'),
          variant: 'success',
        });
        reset();
        onOpenChange(false);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'fees.editContribution' : 'fees.addContribution')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label={t('fees.contributorType')} error={errors.contributorType?.message} required>
            <Controller
              name="contributorType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">{t('fees.contributorIndividual')}</SelectItem>
                    <SelectItem value="anonymous">{t('fees.contributorAnonymous')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label={t('fees.contributorName')} error={errors.contributorName?.message} required>
            <Input
              {...register('contributorName')}
              disabled={contributorType === 'anonymous'}
            />
          </Field>
          <Field label={t('fees.contributionAmount')} error={errors.amount?.message} required>
            <CurrencyInput step="0.01" {...register('amount')} />
          </Field>
          <Field label={t('fees.contributionDate')} error={errors.date?.message} required>
            <Input type="date" {...register('date')} />
          </Field>
          <Field label={t('fees.contributionWhatsappNo')} error={errors.whatsappNo?.message}>
            <Input {...register('whatsappNo')} />
          </Field>
          <Field label={t('fees.contributionNotes')} error={errors.notes?.message}>
            <Input {...register('notes')} />
          </Field>

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
