import { Activity, BarChart3, Gauge, LayoutDashboard, LogOut, Menu, Moon, Sparkles, Sun, Workflow, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import { useThemeStore } from '../store/useThemeStore';
import { AssistantWidget } from './AssistantWidget';
import { EventTab } from './EventTab';
import { DashboardTab } from './DashboardTab';
import { OverviewTab } from './OverviewTab';
import { EVENTS } from './types';

const TABS = [
  { path: 'overview', label: 'Overview', icon: Gauge, event: EVENTS.overview },
  { path: 'dashboard', label: 'Reports', icon: LayoutDashboard, event: EVENTS.dashboard },
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
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  // Shared between Overview, Reports and Chat so a chosen project scopes all three.
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    api<{ eventKey: string }[]>('/api/app/events')
      .then((events) => setAvailable(new Set(events.map((e) => e.eventKey))))
      .catch(() => setAvailable(new Set()));
  }, []);

  useEffect(() => setNavOpen(false), [location.pathname]);

  const unavailable = (event: string) => available !== null && !available.has(event);
  const liveCount = available ? TABS.filter((t) => available.has(t.event)).length : undefined;
  const current = TABS.find((t) => location.pathname.startsWith(`/app/${t.path}`));
  const initial = (user?.email ?? '?').charAt(0).toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20">
          <Sparkles size={17} />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-fg">Manzil</p>
          <p className="text-[11px] text-subtle">Execution Validation</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Sections">
        <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Workspace</p>
        {TABS.map(({ path, label, icon: Icon, event }) => (
          <NavLink
            key={path}
            to={`/app/${path}`}
            title={unavailable(event) ? 'Not published yet' : undefined}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive ? 'bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300' : 'text-fg-soft hover:bg-hover hover:text-fg'
              } ${unavailable(event) ? 'opacity-50' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-sky-500" />}
                <Icon size={16} />
                <span className="flex-1">{label}</span>
                {available && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${unavailable(event) ? 'bg-faint' : 'bg-emerald-500'}`}
                    aria-label={unavailable(event) ? 'Not published' : 'Live'}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}

        {user?.role === 'admin' && (
          <>
            <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Administration</p>
            <Link to="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-soft hover:bg-hover hover:text-fg">
              <Workflow size={16} /> Workflow builder
            </Link>
          </>
        )}
      </nav>

      {liveCount !== undefined && (
        <div className="mx-3 mb-3 rounded-xl border border-line bg-page/60 p-3">
          <p className="flex items-center gap-2 text-xs font-medium text-fg">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {liveCount} of {TABS.length} sections live
          </p>
          <p className="mt-1 text-[11px] leading-snug text-subtle">Each section runs a published workflow.</p>
        </div>
      )}

      <div className="flex items-center gap-2.5 border-t border-line p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-700 text-xs font-semibold text-white">
          {initial}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs font-medium text-fg">{user?.email}</p>
          <p className="text-[11px] capitalize text-subtle">{user?.role}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full bg-page text-fg">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-panel lg:block">{sidebar}</aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setNavOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <aside className="relative h-full w-72 max-w-[85vw] border-r border-line bg-panel shadow-xl">
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-hover"
            >
              <X size={16} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel/80 px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-soft hover:bg-hover lg:hidden"
          >
            <Menu size={16} />
          </button>
          <p className="text-sm text-subtle">
            Manzil <span className="px-1 text-faint">/</span>
            <span className="font-medium text-fg">{current?.label ?? 'Overview'}</span>
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-fg-soft hover:bg-hover"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route index element={<Navigate to="/app/overview" replace />} />
            <Route path="overview" element={<OverviewTab projectId={projectId} onProjectChange={setProjectId} />} />
            <Route path="dashboard" element={<DashboardTab projectId={projectId} onProjectChange={setProjectId} />} />
            <Route path="activity" element={<EventTab key="activity" eventKey={EVENTS.activity} />} />
            <Route path="analytics" element={<EventTab key="analytics" eventKey={EVENTS.analytics} />} />
            <Route path="*" element={<Navigate to="/app/overview" replace />} />
          </Routes>
        </main>
      </div>

      {available?.has(EVENTS.chat) && <AssistantWidget projectId={projectId} />}
    </div>
  );
}
