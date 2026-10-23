import { Activity, BarChart3, Gauge, LayoutDashboard, Menu, Moon, ShieldCheck, Sparkles, Sun, Workflow, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLinks, ProfileCard } from '../admin/AdminBar';
import { api } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import { useThemeStore } from '../store/useThemeStore';
import { AssistantWidget } from './AssistantWidget';
import { DataAccessTab } from './DataAccessTab';
import { EventTab } from './EventTab';
import { DashboardTab } from './DashboardTab';
import { blockIcon } from './icons';
import { OverviewTab } from './OverviewTab';
import { EVENTS, type PublishedEvent } from './types';

/**
 * Pages with their own component. Everything else a workflow asks for (its trigger's
 * "App page name") becomes a generic page at /app/s/<event key>, so a new agent needs
 * a publish, not a front-end change.
 */
const BUILT_IN = [
  { path: 'overview', label: 'Overview', icon: Gauge, event: EVENTS.overview },
  { path: 'dashboard', label: 'Reports', icon: LayoutDashboard, event: EVENTS.dashboard },
  { path: 'activity', label: 'AI Activity', icon: Activity, event: EVENTS.activity },
  { path: 'analytics', label: 'Analytics', icon: BarChart3, event: EVENTS.analytics },
] as const;

const BUILT_IN_EVENTS = new Set<string>(BUILT_IN.map((t) => t.event));
const DEFAULT_GROUP = 'Workspace';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  event: string;
  group: string;
  order: number;
  live: boolean;
}

/** The sidebar's groups, built from the built-in pages plus whatever else is published. */
function navGroups(events: PublishedEvent[] | null): { group: string; entries: NavEntry[] }[] {
  const byKey = new Map((events ?? []).map((e) => [e.eventKey, e]));
  const entries: NavEntry[] = BUILT_IN.map((t) => ({
    to: `/app/${t.path}`,
    label: byKey.get(t.event)?.section || t.label,
    icon: t.icon,
    event: t.event,
    group: byKey.get(t.event)?.group || DEFAULT_GROUP,
    order: byKey.get(t.event)?.order ?? 10,
    live: events === null || byKey.has(t.event),
  }));
  for (const e of events ?? []) {
    if (BUILT_IN_EVENTS.has(e.eventKey) || e.kind === 'chat' || !e.section) continue;
    entries.push({
      to: `/app/s/${encodeURIComponent(e.eventKey)}`,
      label: e.section,
      icon: blockIcon(e.icon, Workflow),
      event: e.eventKey,
      group: e.group || DEFAULT_GROUP,
      order: e.order,
      live: true,
    });
  }
  const groups = new Map<string, NavEntry[]>();
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === DEFAULT_GROUP ? -1 : b === DEFAULT_GROUP ? 1 : a.localeCompare(b)))
    .map(([group, list]) => ({ group, entries: list.sort((x, y) => x.order - y.order || x.label.localeCompare(y.label)) }));
}

/** The end-user app. Everything it shows comes from published workflows; it holds no business logic. */
export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [events, setEvents] = useState<PublishedEvent[] | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  // Shared between Overview, Reports and Chat so a chosen project scopes all three.
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    api<PublishedEvent[]>('/api/app/events')
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [location.pathname]);

  useEffect(() => setNavOpen(false), [location.pathname]);

  const groups = navGroups(events);
  const all = groups.flatMap((g) => g.entries);
  const liveCount = events ? all.filter((e) => e.live).length : undefined;
  const current = all.find((e) => location.pathname === e.to || location.pathname.startsWith(`${e.to}/`));
  const isDataAccess = location.pathname.startsWith('/app/data');
  const currentVersion = current && events?.find((e) => e.eventKey === current.event)?.version;
  // Sections published beyond the built-in pages; each gets a generic page.
  const extraSections = (events ?? []).filter((e) => !BUILT_IN_EVENTS.has(e.eventKey) && e.kind !== 'chat' && e.section);

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
        {groups.map(({ group, entries }) => (
          <div key={group}>
            <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{group}</p>
            {entries.map(({ to, label, icon: Icon, live }) => (
              <NavLink
                key={to}
                to={to}
                title={live ? undefined : 'Not published yet'}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300' : 'text-fg-soft hover:bg-hover hover:text-fg'
                  } ${live ? '' : 'opacity-50'}`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-sky-500" />}
                    <Icon size={16} />
                    <span className="flex-1">{label}</span>
                    {events && (
                      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-faint'}`} aria-label={live ? 'Live' : 'Not published'} />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}

        <NavLink
          to="/app/data"
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive ? 'bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300' : 'text-fg-soft hover:bg-hover hover:text-fg'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-sky-500" />}
              <ShieldCheck size={16} />
              <span className="flex-1">My data access</span>
            </>
          )}
        </NavLink>

        {user?.role === 'admin' && (
          <>
            <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Administration</p>
            <AdminLinks />
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
            {liveCount} of {all.length} sections live
          </p>
          <p className="mt-1 text-[11px] leading-snug text-subtle">Each section runs a published workflow.</p>
        </div>
      )}

      <ProfileCard />
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
            <span className="font-medium text-fg">{isDataAccess ? 'My data access' : (current?.label ?? 'Overview')}</span>
          </p>
          {currentVersion !== undefined && (
            <span
              className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
              title="Version of the published workflow behind this page"
            >
              Workflow v{currentVersion}
            </span>
          )}
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
        {/* relative: absolutely positioned content (e.g. sr-only labels) must stay inside this scroller, not grow the document. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route index element={<Navigate to="/app/overview" replace />} />
            <Route path="overview" element={<OverviewTab projectId={projectId} onProjectChange={setProjectId} />} />
            <Route path="dashboard" element={<DashboardTab projectId={projectId} onProjectChange={setProjectId} />} />
            <Route path="activity" element={<EventTab key="activity" eventKey={EVENTS.activity} />} />
            <Route path="analytics" element={<EventTab key="analytics" eventKey={EVENTS.analytics} />} />
            <Route path="data" element={<DataAccessTab />} />
            {/* Any other published workflow that asked for a page of its own. */}
            {extraSections.map((e) => (
              <Route key={e.eventKey} path={`s/${e.eventKey}`} element={<EventTab key={e.eventKey} eventKey={e.eventKey} />} />
            ))}
            <Route path="*" element={<Navigate to="/app/overview" replace />} />
          </Routes>
        </main>
      </div>

      {/* The assistant uses the Manzil chat workflow when it is live, else any other published chat workflow. */}
      <AssistantWidget
        projectId={projectId}
        chatEvent={(events ?? []).find((e) => e.eventKey === EVENTS.chat)?.eventKey ?? (events ?? []).find((e) => e.kind === 'chat')?.eventKey ?? EVENTS.chat}
      />
    </div>
  );
}
