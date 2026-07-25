import { Navigate, Outlet, useLocation } from 'react-router-dom';
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

/** Gate that restricts a route subtree to holders of a permission key. */
export function RequirePermission({ permission }: { permission: string }) {
  const permissions = useAuthStore((s) => s.user?.permissions);
  if (!permissions?.includes(permission)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
