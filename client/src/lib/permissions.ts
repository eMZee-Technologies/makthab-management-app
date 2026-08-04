import { can, type Action, type ResourceKey, type RolePermissions } from '@makthab/shared';
import { useAuthStore } from '@/store/authStore';

/** Reactive permission check against the logged-in user's permissionMatrix. */
export function useCan() {
  const matrix = useAuthStore((s) => s.user?.permissionMatrix);
  return (resource: ResourceKey, action: Action) => can(matrix, resource, action);
}

export function usePermissionMatrix(): RolePermissions | undefined {
  return useAuthStore((s) => s.user?.permissionMatrix);
}

export function canFromUser(
  matrix: RolePermissions | undefined,
  resource: ResourceKey,
  action: Action,
): boolean {
  return can(matrix, resource, action);
}
