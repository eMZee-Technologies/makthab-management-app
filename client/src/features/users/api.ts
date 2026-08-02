import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { User } from '@/types/domain';
import type { UserCreateInput, UserUpdateInput } from '@/lib/schemas';

export interface UserListParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  role?: string;
  status?: string;
}

export function useUsers(params: UserListParams = {}) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: async () => {
      const payload = unwrap((await api.get('/users', { params })).data) as {
        items?: User[];
        total?: number;
      };
      return { items: payload.items ?? [], total: payload.total ?? payload.items?.length ?? 0 };
    },
  });
}

export function useAddUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UserCreateInput) => unwrap<User>((await api.post('/users', input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UserUpdateInput) =>
      unwrap<User>((await api.patch(`/users/${id}`, input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/users/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/** Reactivate a deactivated login (id supplied at mutate time, unlike useUpdateUser). */
export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap<User>((await api.patch(`/users/${id}`, { status: 'active' })).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResetUserPassword(id: number) {
  return useMutation({
    mutationFn: async (password: string) =>
      unwrap<{ id: number }>((await api.post(`/users/${id}/reset-password`, { password })).data),
  });
}

export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; role?: string; note?: string }) =>
      unwrap<User>((await api.post(`/users/${input.id}/approve`, { role: input.role, note: input.note })).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useRejectUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; reason: string }) =>
      unwrap<User>((await api.post(`/users/${input.id}/reject`, { reason: input.reason })).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
