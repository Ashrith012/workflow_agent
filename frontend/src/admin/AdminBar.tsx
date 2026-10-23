import { LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, Send, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';

const STAFF_LINKS = {
  // Tenant admin: governs in the console, can still drop into the builder.
  admin: [
    { to: '/admin', label: 'Tenant console', icon: ShieldCheck, end: false },
    { to: '/builder', label: 'Builder', icon: Workflow, end: true },
    { to: '/fde', label: 'Submissions', icon: Send, end: false },
    { to: '/app', label: 'End-user app', icon: LayoutDashboard, end: false },
  ],
  // FDE: builds and submits; the tenant admin approves. No end-user app access.
  fde: [
    { to: '/builder', label: 'Builder', icon: Workflow, end: true },
    { to: '/fde', label: 'Submit & approvals', icon: Send, end: false },
  ],
} as const;

/** Navigation between the builder, the FDE console and the rest, per role. */
export function AdminLinks({ onSelect }: { onSelect?: () => void }) {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'admin' && role !== 'fde') return null;
  return (
    <>
      {STAFF_LINKS[role].map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onSelect}
          className={({ isActive }) =>
            `relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive ? 'bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300' : 'text-fg-soft hover:bg-hover hover:text-fg'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-sky-500" />}
              <Icon size={16} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

/** Signed-in user and sign out, pinned to the bottom of a sidebar. */
export function ProfileCard() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const roleLabel = user?.role === 'admin' ? 'Tenant admin' : user?.role === 'fde' ? 'FDE' : 'End user';
  return (
    <div className="flex items-center gap-2.5 border-t border-line p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-700 text-xs font-semibold text-white">
        {(user?.email ?? '?').charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-medium text-fg">{user?.email}</p>
        <p className="text-[11px] text-subtle">{roleLabel}</p>
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
  );
}

/**
 * Builder and FDE-console layout: the sidebar is open on arrival and hides
 * once a page is chosen; the slim rail's button brings it back.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  const [open, setOpen] = useState(true);
  return (
    <div className="flex h-full bg-page text-fg">
      {open ? (
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
          <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20">
              <Sparkles size={15} />
            </span>
            <p className="flex-1 text-sm font-semibold text-fg">{role === 'admin' ? 'Manzil Studio' : 'FDE Studio'}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Hide navigation"
              title="Hide navigation"
              className="flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          <nav className="flex-1 space-y-0.5 p-3" aria-label="Studio">
            <AdminLinks onSelect={() => setOpen(false)} />
          </nav>
          <ProfileCard />
        </aside>
      ) : (
        <div className="flex w-12 shrink-0 flex-col items-center border-r border-line bg-panel py-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Show navigation"
            title="Show navigation"
            className="flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
