import { useEffect, useRef, useState, type ChangeEvent } from 'react';
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
import { studentCreateSchema, type StudentCreateInput } from '@/lib/schemas';
import { useClasses, useAcademicYears } from '@/api/reference';
import { useUiStore } from '@/store/uiStore';
import { api, extractApiError } from '@/api/client';
import { useAdmitStudent, useUpdateStudent, useUploadStudentPhoto } from './api';
import type { Student } from '@/types/domain';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: Student | null;
}

export function StudentForm({ open, onOpenChange, student }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isEdit = student != null;
  const admit = useAdmitStudent();
  const update = useUpdateStudent(student?.id ?? 0);
  const uploadPhoto = useUploadStudentPhoto();
  const mutation = isEdit ? update : admit;
  const { data: classes } = useClasses();
  const { data: years } = useAcademicYears();
  const academicYearId = useUiStore((s) => s.academicYearId);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<StudentCreateInput>({
    resolver: zodResolver(studentCreateSchema),
    defaultValues: {
      gender: 'male',
      academicYearId: academicYearId ?? undefined,
    } as Partial<StudentCreateInput> as StudentCreateInput,
  });

  // Tracks the classId reset() last set, so the classId-change effect below
  // can tell "class just got (re)loaded into the form" apart from "the user
  // actually picked a different class" — only the latter should clear category.
  const lastResetClassId = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const initial = student
      ? ({
          admissionNo: student.admissionNo,
          fullName: student.fullName,
          fatherName: student.fatherName,
          dateOfBirth: student.dateOfBirth?.slice(0, 10),
          gender: student.gender,
          contactNo: student.contactNo,
          whatsappNo: student.whatsappNo,
          address: student.address ?? undefined,
          classId: student.classId,
          categoryId: student.categoryId ?? undefined,
          academicYearId: student.academicYearId,
          status: student.status === 'inactive' ? 'inactive' : 'active',
        } as StudentCreateInput)
      : ({
          gender: 'male',
          academicYearId: academicYearId ?? undefined,
          status: 'active',
        } as Partial<StudentCreateInput> as StudentCreateInput);
    lastResetClassId.current = initial.classId;
    reset(initial);
  }, [open, student, academicYearId, reset]);

  const classId = watch('classId');
  const selectedClass = (classes ?? []).find((c) => c.id === Number(classId));
  const categoryOptions = (selectedClass?.categories ?? []).map((c) => ({ value: c.id, label: c.name }));

  // Clear the category once the user actually switches to a different class
  // (a category from the old class is never valid for the new one).
  useEffect(() => {
    if (classId === lastResetClassId.current) return;
    lastResetClassId.current = classId;
    setValue('categoryId', undefined);
  }, [classId, setValue]);

  // Load an existing student's photo for the preview (authed blob fetch — a plain
  // <img src> can't send the Bearer token). Clears any locally-picked file first.
  useEffect(() => {
    if (!open) return;
    setPhotoFile(null);
    setPreviewUrl(null);
    if (!student?.photoPath) return;
    let active = true;
    api
      .get(`/students/${student.id}/photo`, { responseType: 'blob' })
      .then((res) => {
        if (active) setPreviewUrl(URL.createObjectURL(res.data as Blob));
      })
      .catch(() => {
        /* no photo / not found — leave preview empty */
      });
    return () => {
      active = false;
    };
  }, [open, student]);

  // Revoke the previous object URL whenever the preview changes or on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = isEdit
        ? await update.mutateAsync(values)
        : await admit.mutateAsync(values);
      if (photoFile) {
        await uploadPhoto.mutateAsync({ id: saved.id, file: photoFile });
      }
      toast({ title: t(isEdit ? 'students.updated' : 'students.created'), variant: 'success' });
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
          <DialogTitle>{t(isEdit ? 'students.edit' : 'students.admit')}</DialogTitle>
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
                  {t('students.photo')}
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
                    id="student-status"
                    type="checkbox"
                    className="h-4 w-4 rounded border-input accent-primary"
                    checked={field.value !== 'inactive'}
                    onChange={(e) => field.onChange(e.target.checked ? 'active' : 'inactive')}
                  />
                )}
              />
              <Label htmlFor="student-status">{t('common.active')}</Label>
            </div>
          </div>

          <Field label={t('students.admissionNo')} error={errors.admissionNo?.message} required>
            <Input {...register('admissionNo')} />
          </Field>
          <Field label={t('students.fullName')} error={errors.fullName?.message} required>
            <Input {...register('fullName')} />
          </Field>
          <Field label={t('students.fatherName')} error={errors.fatherName?.message} required>
            <Input {...register('fatherName')} />
          </Field>
          <Field label={t('students.dateOfBirth')} error={errors.dateOfBirth?.message} required>
            <Input type="date" {...register('dateOfBirth')} />
          </Field>
          <SelectField
            name="gender"
            control={control}
            label={t('students.gender')}
            error={errors.gender?.message}
            required
            options={[
              { value: 'male', label: t('students.male') },
              { value: 'female', label: t('students.female') },
            ]}
          />
          <SelectField
            name="classId"
            control={control}
            label={t('students.class')}
            error={errors.classId?.message}
            required
            placeholder={t('common.all')}
            options={(classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          {categoryOptions.length > 0 && (
            <SelectField
              name="categoryId"
              control={control}
              label={t('students.category')}
              error={errors.categoryId?.message}
              required
              options={categoryOptions}
            />
          )}
          <SelectField
            name="academicYearId"
            control={control}
            label={t('common.academicYear')}
            error={errors.academicYearId?.message}
            required
            options={(years ?? []).map((y) => ({ value: y.id, label: y.name }))}
          />
          <Field label={t('students.contactNo')} error={errors.contactNo?.message} required>
            <Input {...register('contactNo')} />
          </Field>
          <Field label={t('students.whatsappNo')} error={errors.whatsappNo?.message} required>
            <Input {...register('whatsappNo')} />
          </Field>
          <Field label={t('students.address')} error={errors.address?.message} className="sm:col-span-2">
            <Input {...register('address')} />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || uploadPhoto.isPending}>
              {(mutation.isPending || uploadPhoto.isPending) && <Spinner className="me-2" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
