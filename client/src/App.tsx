import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth, RequirePermission } from '@/components/RequireAuth';
import { Toaster } from '@/components/ui/toaster';
import { LoginPage } from '@/features/auth/LoginPage';
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

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="students" element={<StudentsPage />} />

            <Route element={<RequirePermission permission="classes.manage" />}>
              <Route path="classes" element={<ClassesPage />} />
            </Route>
            <Route element={<RequirePermission permission="users.manage" />}>
              <Route path="users" element={<UsersPage />} />
            </Route>
            <Route element={<RequirePermission permission="org.manage" />}>
              <Route path="organisation" element={<OrgProfilesPage />} />
            </Route>
            <Route element={<RequirePermission permission="roles.manage" />}>
              <Route path="roles" element={<RolesPage />} />
            </Route>

            <Route element={<RequirePermission permission="fees.manage" />}>
              <Route path="fees" element={<FeesPage />} />
            </Route>
            <Route element={<RequirePermission permission="finance.manage" />}>
              <Route path="finance" element={<FinancePage />} />
            </Route>
            <Route element={<RequirePermission permission="reports.access" />}>
              <Route path="reports" element={<ReportsPage />} />
            </Route>

            <Route element={<RequirePermission permission="attendance.mark" />}>
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
