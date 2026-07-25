import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { Attendance, AttendanceSummaryRow } from '@/types/domain';

export interface AttendanceListParams {
  student_id?: number;
  class_id?: number;
  category_id?: number;
  date?: string;
  month?: number;
  year?: number;
}

export interface MarkRecord {
  studentId: number;
  date: string;
  status: string;
  notes?: string;
}

function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const p = data as { items?: T[] };
  return p.items ?? [];
}

export function useAttendance(params: AttendanceListParams) {
  return useQuery({
    queryKey: ['attendance', params],
    enabled: params.date != null || params.month != null,
    queryFn: async () => toArray<Attendance>(unwrap((await api.get('/attendance', { params })).data)),
  });
}

export interface AttendanceSummaryParams {
  month: number;
  year: number;
  class_id?: number;
  category_id?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useAttendanceSummary(params: AttendanceSummaryParams) {
  return useQuery({
    queryKey: ['attendance', 'summary', params],
    queryFn: async () => {
      const payload = unwrap((await api.get('/attendance/summary', { params })).data) as {
        items?: AttendanceSummaryRow[];
        total?: number;
      };
      return {
        items: payload.items ?? [],
        total: payload.total ?? payload.items?.length ?? 0,
      };
    },
  });
}

export function useLowAlert() {
  return useQuery({
    queryKey: ['attendance', 'low-alert'],
    queryFn: async () =>
      toArray<{ studentId: number; fullName: string; percentage: number }>(
        unwrap((await api.get('/attendance/low-alert')).data),
      ),
  });
}

export function useMarkAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (records: MarkRecord[]) => (await api.post('/attendance', records)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
