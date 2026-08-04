import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { can, type Action, type ResourceKey } from '@makthab/shared';
import { useAuthStore } from '@/store/authStore';

/** Gate that redirects unauthenticated users to /login. */
export function RequireAuth() {
  const isAuthed = useAuthStore((s) => s.isAuthenticated());
  const location = useLocation();

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Gate that restricts a route subtree to a resource × action grant. */
export function RequirePermission({
  resource,
  action = 'view',
}: {
  resource: ResourceKey;
  action?: Action;
}) {
  const matrix = useAuthStore((s) => s.user?.permissionMatrix);
  if (!can(matrix, resource, action)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
