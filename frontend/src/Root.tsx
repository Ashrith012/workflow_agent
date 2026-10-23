import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AdminConsole } from './admin/AdminConsole';
import { AdminLayout } from './admin/AdminBar';
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

  const isAdmin = user?.role === 'admin';
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        {!user ? (
          <Route path="*" element={<Navigate to="/login" replace />} />
        ) : (
          <>
            {/* One layout route, so the admin sidebar keeps its state when switching between the two pages. */}
            <Route element={isAdmin ? <AdminLayout><Outlet /></AdminLayout> : <Navigate to="/app" replace />}>
              <Route path="/" element={<App />} />
              <Route path="/admin" element={<AdminConsole />} />
            </Route>
            <Route path="/app/*" element={<AppShell />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
