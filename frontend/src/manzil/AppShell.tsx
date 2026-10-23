import { Activity, BarChart3, LayoutDashboard, LogOut, MessageSquare, Moon, Sun, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import { useThemeStore } from '../store/useThemeStore';
import { ChatTab } from './ChatTab';
import { EventTab } from './EventTab';
import { DashboardTab } from './DashboardTab';
import { EVENTS } from './types';

const TABS = [
  { path: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, event: EVENTS.dashboard },
  { path: 'chat', label: 'Chat with AI', icon: MessageSquare, event: EVENTS.chat },
  { path: 'activity', label: 'AI Activity', icon: Activity, event: EVENTS.activity },
  { path: 'analytics', label: 'Analytics', icon: BarChart3, event: EVENTS.analytics },
] as const;

/** The end-user app. Everything it shows comes from published workflows; it holds no business logic. */
export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [available, setAvailable] = useState<Set<string> | null>(null);
  // Shared between Dashboard and Chat so a chosen project scopes both.
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    api<{ eventKey: string }[]>('/api/app/events')
      .then((events) => setAvailable(new Set(events.map((e) => e.eventKey))))
      .catch(() => setAvailable(new Set()));
  }, []);

  const unavailable = (event: string) => available !== null && !available.has(event);

  return (
    <div className="flex h-full flex-col bg-page text-fg">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
        <span className="text-sm font-semibold">Project Execution Validation</span>
        <nav className="flex items-center gap-1" aria-label="Sections">
          {TABS.map(({ path, label, icon: Icon, event }) => (
            <NavLink
              key={path}
              to={`/app/${path}`}
              title={unavailable(event) ? 'Not published yet' : undefined}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive ? 'bg-hover font-medium text-fg' : 'text-subtle hover:text-fg-soft'
                } ${unavailable(event) ? 'opacity-50' : ''}`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-xs text-subtle">
          {user?.role === 'admin' && (
            <Link to="/" className="flex items-center gap-1 rounded px-2 py-1 hover:text-fg-soft">
              <Workflow size={13} /> Builder
            </Link>
          )}
          <span>{user?.email}</span>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-soft hover:bg-hover"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button type="button" onClick={() => void logout()} className="flex items-center gap-1 rounded px-2 py-1 hover:text-fg-soft">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardTab projectId={projectId} onProjectChange={setProjectId} />} />
          <Route path="chat" element={<ChatTab projectId={projectId} />} />
          <Route path="activity" element={<EventTab key="activity" eventKey={EVENTS.activity} />} />
          <Route path="analytics" element={<EventTab key="analytics" eventKey={EVENTS.analytics} />} />
          <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
