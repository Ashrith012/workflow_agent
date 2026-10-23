import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './admin/AdminBar';
import { FdeConsole } from './admin/FdeConsole';
import { TenantConsole } from './admin/tenant/TenantConsole';
import App from './App';
import { AppShell } from './manzil/AppShell';
import { LoginPage } from './LoginPage';
import { useAuthStore } from './store/useAuthStore';

export function Root() {
  const user = useAuthStore((s) => s.user);
  const load = useAuthStore((s) => s.load);
  const [error, setError] = useState<string>();

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (user === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  // admin governs in the tenant console; fde builds; user only sees the app.
  const isAdmin = user?.role === 'admin';
  const canBuild = isAdmin || user?.role === 'fde';
  const home = isAdmin ? '/admin/overview' : canBuild ? '/builder' : '/app';
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to={home} replace /> : <LoginPage />} />
        {!user ? (
          <Route path="*" element={<Navigate to="/login" replace />} />
        ) : (
          <>
            {isAdmin && <Route path="/admin/:section?" element={<TenantConsole />} />}
            {canBuild && (
              /* One layout route, so the studio sidebar keeps its state when switching between the two pages. */
              <Route element={<AdminLayout><Outlet /></AdminLayout>}>
                <Route path="/builder" element={<App />} />
                <Route path="/fde" element={<FdeConsole />} />
              </Route>
            )}
            {/* The end-user app belongs to end users (and the admin for oversight), never to FDEs. */}
            {user.role !== 'fde' && <Route path="/app/*" element={<AppShell />} />}
            <Route path="*" element={<Navigate to={home} replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
