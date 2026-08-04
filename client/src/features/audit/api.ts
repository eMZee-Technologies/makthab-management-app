import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { AuditLogDto, AuditIntegrityResult, Paginated } from '@makthab/shared';

export type AuditLogListParams = {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  userId?: number;
  action?: string;
  entity?: string;
  outcome?: 'success' | 'failure';
  resourceId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

export function useAuditLogs(params: AuditLogListParams) {
  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: async () => {
      const res = await api.get('/admin/audit-logs', { params });
      return unwrap<Paginated<AuditLogDto>>(res.data);
    },
  });
}

export function useAuditLog(id: string | null) {
  return useQuery({
    queryKey: ['audit-logs', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.get(`/admin/audit-logs/${id}`);
      return unwrap<AuditLogDto>(res.data);
    },
  });
}

export function useAuditIntegrity(enabled: boolean) {
  return useQuery({
    queryKey: ['audit-logs', 'integrity'],
    enabled,
    queryFn: async () => {
      const res = await api.get('/admin/audit-logs/integrity');
      return unwrap<AuditIntegrityResult>(res.data);
    },
    staleTime: 30_000,
  });
}
