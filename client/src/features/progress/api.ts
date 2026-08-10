import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { MonthlyProgress, Paginated, ProgressBoardRow } from '@/types/domain';
import type { MonthlyProgressFormInput } from '@/lib/schemas';

export interface ProgressBoardParams {
  month: number;
  year: number;
  class_id?: number;
  q?: string;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

function parseLinksText(text?: string | null): { url: string; label?: string }[] | null {
  if (!text?.trim()) return null;
  const links: { url: string; label?: string }[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [url, ...rest] = trimmed.split(/\s+\|\s+/);
    if (!url) continue;
    links.push(rest.length ? { url: url.trim(), label: rest.join(' | ').trim() } : { url: url.trim() });
  }
  return links.length ? links : null;
}

export function toProgressPayload(input: MonthlyProgressFormInput) {
  const { linksText, ...rest } = input;
  return {
    ...rest,
    previousMonthComparison: rest.previousMonthComparison || null,
    progressPercent: rest.progressPercent ?? null,
    assignmentsCompleted: rest.assignmentsCompleted || null,
    softSkills: rest.softSkills || null,
    reminders: rest.reminders || null,
    nextSteps: rest.nextSteps || null,
    links: parseLinksText(linksText),
  };
}

export function useProgressBoard(params: ProgressBoardParams) {
  return useQuery({
    queryKey: ['progress-board', params],
    queryFn: async () => {
      const res = await api.get('/progress/board', { params });
      return unwrap<Paginated<ProgressBoardRow>>(res.data);
    },
  });
}

export function useCreateProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MonthlyProgressFormInput) =>
      unwrap<MonthlyProgress>((await api.post('/progress', toProgressPayload(input))).data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['progress-board'] });
      void qc.invalidateQueries({ queryKey: ['progress'] });
    },
  });
}

export function useUpdateProgress(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MonthlyProgressFormInput) => {
      const payload = toProgressPayload(input);
      const { studentId: _s, month: _m, year: _y, ...patch } = payload;
      return unwrap<MonthlyProgress>((await api.patch(`/progress/${id}`, patch)).data);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['progress-board'] });
      const snapshots = qc.getQueriesData<Paginated<ProgressBoardRow>>({ queryKey: ['progress-board'] });
      const patch = toProgressPayload(input);
      for (const [key, data] of snapshots) {
        if (!data?.items) continue;
        qc.setQueryData(key, {
          ...data,
          items: data.items.map((row) =>
            row.progress?.id === id
              ? {
                  ...row,
                  progress: {
                    ...row.progress,
                    ...patch,
                    links: patch.links ?? row.progress.links,
                    updatedAt: new Date().toISOString(),
                  } as MonthlyProgress,
                }
              : row,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _input, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['progress-board'] });
      void qc.invalidateQueries({ queryKey: ['progress'] });
    },
  });
}

export function useDeleteProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => unwrap<{ id: number }>((await api.delete(`/progress/${id}`)).data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['progress-board'] });
    },
  });
}

export function useSendProgressWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap<{ mode: 'walink'; link: string; whatsappSent: boolean; message: string }>(
        (await api.post(`/progress/${id}/whatsapp`)).data,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['progress-board'] });
    },
  });
}

export function useUploadProgressAttachment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(`/progress/${id}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return unwrap<MonthlyProgress>(res.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['progress-board'] });
    },
  });
}

export function useDeleteProgressAttachment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) =>
      unwrap<MonthlyProgress>((await api.delete(`/progress/${id}/attachments`, { data: { key } })).data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['progress-board'] });
    },
  });
}
