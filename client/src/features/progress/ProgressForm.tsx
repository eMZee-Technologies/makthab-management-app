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
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/form/Field';
import { SelectField } from '@/components/form/SelectField';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { monthlyProgressFormSchema, type MonthlyProgressFormInput } from '@/lib/schemas';
import { extractApiError } from '@/api/client';
import type { MonthlyProgress, Student } from '@/types/domain';
import {
  useCreateProgress,
  useUpdateProgress,
  useUploadProgressAttachment,
  useDeleteProgressAttachment,
} from './api';

const MOODS = ['excellent', 'good', 'average', 'needs_attention'] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
  month: number;
  year: number;
  progress?: MonthlyProgress | null;
}

function linksToText(links: { url: string; label?: string }[] | undefined): string {
  if (!links?.length) return '';
  return links.map((l) => (l.label ? `${l.url} | ${l.label}` : l.url)).join('\n');
}

export function ProgressForm({ open, onOpenChange, student, month, year, progress }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = progress != null;
  const create = useCreateProgress();
  const update = useUpdateProgress(progress?.id ?? 0);
  const upload = useUploadProgressAttachment(progress?.id ?? 0);
  const removeAttachment = useDeleteProgressAttachment(progress?.id ?? 0);
  const mutation = isEdit ? update : create;
  const [showMore, setShowMore] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<MonthlyProgressFormInput>({
    resolver: zodResolver(monthlyProgressFormSchema),
    defaultValues: {
      studentId: student.id,
      month,
      year,
      hoursStudied: 0,
      attendanceDays: 0,
      moodEngagement: 'good',
      topicsCovered: '',
      assessments: '',
      goals: '',
      notes: '',
      linksText: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      studentId: student.id,
      month: progress?.month ?? month,
      year: progress?.year ?? year,
      hoursStudied: progress?.hoursStudied ?? 0,
      topicsCovered: progress?.topicsCovered ?? '',
      assessments: progress?.assessments ?? '',
      attendanceDays: progress?.attendanceDays ?? 0,
      moodEngagement: progress?.moodEngagement ?? 'good',
      goals: progress?.goals ?? '',
      notes: progress?.notes ?? '',
      previousMonthComparison: progress?.previousMonthComparison ?? '',
      progressPercent: progress?.progressPercent ?? null,
      assignmentsCompleted: progress?.assignmentsCompleted ?? '',
      softSkills: progress?.softSkills ?? '',
      reminders: progress?.reminders ?? '',
      nextSteps: progress?.nextSteps ?? '',
      linksText: linksToText(progress?.links),
    });
    setShowMore(
      Boolean(
        progress?.previousMonthComparison ||
          progress?.progressPercent != null ||
          progress?.assignmentsCompleted ||
          progress?.softSkills ||
          progress?.reminders ||
          progress?.nextSteps ||
          progress?.links?.length,
      ),
    );
  }, [open, student, month, year, progress, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values);
      toast({
        title: isEdit ? t('progress.updated') : t('progress.created'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !progress) return;
    try {
      await upload.mutateAsync(file);
      toast({ title: t('progress.attachmentAdded'), variant: 'success' });
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  const onRemoveAttachment = async (key: string) => {
    if (!progress) return;
    try {
      await removeAttachment.mutateAsync(key);
      toast({ title: t('progress.attachmentRemoved'), variant: 'success' });
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('progress.edit') : t('progress.create')}</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field label={t('progress.studentName')} required>
            <Input value={student.fullName} readOnly aria-readonly className="bg-muted" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('progress.month')} required>
              <Input value={String(month)} readOnly aria-readonly className="bg-muted" />
            </Field>
            <Field label={t('progress.year')} required>
              <Input value={String(year)} readOnly aria-readonly className="bg-muted" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('progress.hoursStudied')} error={errors.hoursStudied?.message} required>
              <Input type="number" step="0.5" min={0} {...register('hoursStudied')} />
            </Field>
            <Field
              label={t('progress.attendanceDays')}
              error={errors.attendanceDays?.message}
              required
            >
              <Input type="number" min={0} max={31} {...register('attendanceDays')} />
            </Field>
          </div>

          <Field label={t('progress.topicsCovered')} error={errors.topicsCovered?.message} required>
            <Textarea rows={2} {...register('topicsCovered')} />
          </Field>

          <Field label={t('progress.assessments')} error={errors.assessments?.message} required>
            <Textarea rows={2} {...register('assessments')} />
          </Field>

          <SelectField
            name="moodEngagement"
            control={control}
            label={t('progress.moodEngagement')}
            error={errors.moodEngagement?.message}
            required
            options={MOODS.map((m) => ({
              value: m,
              label: t(`progress.mood.${m}`),
            }))}
          />

          <Field label={t('progress.goals')} error={errors.goals?.message} required>
            <Textarea rows={2} {...register('goals')} />
          </Field>

          <Field label={t('progress.notes')} error={errors.notes?.message} required>
            <Textarea rows={2} {...register('notes')} />
          </Field>

          <Button type="button" variant="ghost" size="sm" onClick={() => setShowMore((v) => !v)}>
            {showMore ? t('progress.hideMore') : t('progress.showMore')}
          </Button>

          {showMore && (
            <div className="space-y-4 rounded-md border border-dashed p-3">
              <Field
                label={t('progress.previousMonthComparison')}
                error={errors.previousMonthComparison?.message}
              >
                <Textarea rows={2} {...register('previousMonthComparison')} />
              </Field>
              <Field label={t('progress.progressPercent')} error={errors.progressPercent?.message}>
                <Input type="number" min={0} max={100} {...register('progressPercent')} />
              </Field>
              <Field
                label={t('progress.assignmentsCompleted')}
                error={errors.assignmentsCompleted?.message}
              >
                <Textarea rows={2} {...register('assignmentsCompleted')} />
              </Field>
              <Field label={t('progress.softSkills')} error={errors.softSkills?.message}>
                <Textarea rows={2} {...register('softSkills')} />
              </Field>
              <Field label={t('progress.reminders')} error={errors.reminders?.message}>
                <Textarea rows={2} {...register('reminders')} />
              </Field>
              <Field label={t('progress.nextSteps')} error={errors.nextSteps?.message}>
                <Textarea rows={2} {...register('nextSteps')} />
              </Field>
              <Field label={t('progress.links')} error={errors.linksText?.message}>
                <Textarea
                  rows={3}
                  placeholder={t('progress.linksHint')}
                  {...register('linksText')}
                />
              </Field>
            </div>
          )}

          {isEdit && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('progress.attachments')}</p>
              <p className="text-xs text-muted-foreground">{t('progress.privacyNote')}</p>
              <ul className="space-y-1 text-sm">
                {(progress?.attachments ?? []).map((a) => (
                  <li key={a.key} className="flex items-center justify-between gap-2">
                    <span className="truncate">{a.filename}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void onRemoveAttachment(a.key)}
                      disabled={removeAttachment.isPending}
                    >
                      {t('common.delete')}
                    </Button>
                  </li>
                ))}
              </ul>
              <Input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => void onFile(e)}
                disabled={upload.isPending}
              />
            </div>
          )}

          {isEdit && progress?.editedBy && (
            <p className="text-xs text-muted-foreground">
              {t('progress.auditTrail', {
                name: progress.editedBy.fullName,
                at: new Date(progress.updatedAt).toLocaleString(),
              })}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner className="me-2 h-4 w-4" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
