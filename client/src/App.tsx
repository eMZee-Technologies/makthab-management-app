import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth, RequirePermission } from '@/components/RequireAuth';
import { Toaster } from '@/components/ui/toaster';
import { LoginPage } from '@/features/auth/LoginPage';
import { SignupPage } from '@/features/auth/SignupPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { StudentsPage } from '@/features/students/StudentsPage';
import { ClassesPage } from '@/features/classes/ClassesPage';
import { FeesPage } from '@/features/fees/FeesPage';
import { AttendancePage } from '@/features/attendance/AttendancePage';
import { FinancePage } from '@/features/finance/FinancePage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { UsersPage } from '@/features/users/UsersPage';
import { OrgProfilesPage } from '@/features/org/OrgProfilesPage';
import { RolesPage } from '@/features/roles/RolesPage';
import { AuditLogsPage } from '@/features/audit/AuditLogsPage';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<SignupPage />} />
        <Route path="/signup" element={<Navigate to="/register" replace />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="students" element={<StudentsPage />} />

            <Route element={<RequirePermission resource="classes" action="view" />}>
              <Route path="classes" element={<ClassesPage />} />
            </Route>
            <Route element={<RequirePermission resource="users" action="view" />}>
              <Route path="users" element={<UsersPage />} />
            </Route>
            <Route element={<RequirePermission resource="organisation" action="view" />}>
              <Route path="organisation" element={<OrgProfilesPage />} />
            </Route>
            <Route element={<RequirePermission resource="roles" action="view" />}>
              <Route path="roles" element={<RolesPage />} />
            </Route>
            <Route element={<RequirePermission resource="admin" action="view" />}>
              <Route path="audit-logs" element={<AuditLogsPage />} />
            </Route>

            <Route element={<RequirePermission resource="fees" action="view" />}>
              <Route path="fees" element={<FeesPage />} />
            </Route>
            <Route element={<RequirePermission resource="finance" action="view" />}>
              <Route path="finance" element={<FinancePage />} />
            </Route>
            <Route element={<RequirePermission resource="reports" action="view" />}>
              <Route path="reports" element={<ReportsPage />} />
            </Route>

            <Route element={<RequirePermission resource="attendance" action="view" />}>
              <Route path="attendance" element={<AttendancePage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
