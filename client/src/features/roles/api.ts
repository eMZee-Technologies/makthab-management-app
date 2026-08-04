import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { RolePermissions, RolePermissionsMatrix } from '@makthab/shared';

export interface Role {
  id: number;
  name: string;
  permissions: string[];
  permissionMatrix: RolePermissions;
  isSystem: boolean;
  isFullAccess: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type RoleWriteInput = {
  name?: string;
  inheritsFromAdmin?: boolean;
  permissionMatrix?: RolePermissionsMatrix;
  /** @deprecated Phase 1 legacy — prefer permissionMatrix */
  permissions?: string[];
};

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const payload = unwrap((await api.get('/roles')).data) as { items?: Role[] } | Role[];
      return Array.isArray(payload) ? payload : payload.items ?? [];
    },
  });
}

export function useAddRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RoleWriteInput) => unwrap<Role>((await api.post('/roles', input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}

export function useUpdateRole(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RoleWriteInput) =>
      unwrap<Role>((await api.patch(`/roles/${id}`, input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/roles/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
}
