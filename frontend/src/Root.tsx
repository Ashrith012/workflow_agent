import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminConsole } from './admin/AdminConsole';
import { AdminBar } from './admin/AdminBar';
import App from './App';
import { AppShell } from './manzil/AppShell';
import { LoginPage } from './LoginPage';
import { useAuthStore } from './store/useAuthStore';

/** The builder (App) is untouched; administrators get it under a thin navigation bar. */
function BuilderPage() {
  return (
    <div className="flex h-full flex-col">
      <AdminBar />
      <div className="min-h-0 flex-1">
        <App />
      </div>
    </div>
  );
}

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
            <Route path="/" element={isAdmin ? <BuilderPage /> : <Navigate to="/app" replace />} />
            <Route path="/admin" element={isAdmin ? <AdminConsole /> : <Navigate to="/app" replace />} />
            <Route path="/app/*" element={<AppShell />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
