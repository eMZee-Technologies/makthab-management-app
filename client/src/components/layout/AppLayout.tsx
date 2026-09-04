import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-4 lg:p-6">
          <div className="mx-auto max-w-7xl space-y-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
