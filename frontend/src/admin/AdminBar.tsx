import { LayoutDashboard, LogOut, Send, Workflow } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${isActive ? 'bg-hover text-fg' : 'text-subtle hover:text-fg-soft'}`;

/** Administrator navigation between the builder, the publish console and the end-user app. */
export function AdminBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  return (
    <nav className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-page px-3 text-xs">
      <NavLink to="/" end className={linkClass}>
        <Workflow size={13} /> Builder
      </NavLink>
      <NavLink to="/admin" className={linkClass}>
        <Send size={13} /> Publish & users
      </NavLink>
      <NavLink to="/app" className={linkClass}>
        <LayoutDashboard size={13} /> End-user app
      </NavLink>
      <span className="ml-auto text-subtle">{user?.email}</span>
      <button type="button" onClick={() => void logout()} className="flex items-center gap-1 rounded px-2 py-1 text-subtle hover:text-fg-soft">
        <LogOut size={13} /> Sign out
      </button>
    </nav>
  );
}
