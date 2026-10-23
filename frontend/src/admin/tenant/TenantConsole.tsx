/**
 * Tenant Admin console. Governs what FDEs can build with (models, connectors,
 * guardrails), approves their workflow versions, and audits everything —
 * a separate persona from the FDE, who works in the builder.
 */
import {
  Boxes,
  CheckSquare,
  Cpu,
  FileClock,
  Gauge,
  LayoutDashboard,
  LogOut,
  ShieldAlert,
  Users,
  Workflow,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/useAuthStore';
import { ApprovalsPage } from './ApprovalsPage';
import { AuditPage } from './AuditPage';
import { ConnectorsPage } from './ConnectorsPage';
import { GuardrailsPage } from './GuardrailsPage';
import { ModelsPage } from './ModelsPage';
import { OverviewPage } from './OverviewPage';
import { UsersPage } from './UsersPage';

export interface OverviewData {
  counts: { published: number; pendingApprovals: number; openAlerts: number; users: number; runs30d: number; failed30d: number };
  byWorkflow: { name: string; total: number; failed: number }[];
  alerts: { id: string; severity: string; title: string; detail: string; created_at: string }[];
  approvals: { id: string; event_key: string; name: string; submitted_at: string; submitted_by: string | null }[];
  models: { model_key: string; name: string; provider: string; version: string; status: string; used_by: number }[];
}

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: Gauge, sub: 'Tenant health at a glance' },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare, sub: 'Workflow versions waiting for the business unit owner' },
  { id: 'models', label: 'Models', icon: Cpu, sub: 'Hosted and self-hosted models available to this tenant' },
  { id: 'connectors', label: 'Connectors and MCP', icon: Boxes, sub: 'Systems agents are allowed to read from and write to' },
  { id: 'guardrails', label: 'Guardrails', icon: ShieldAlert, sub: 'Alerts raised by policy checks on agent input and output' },
  { id: 'people', label: 'Users and roles', icon: Users, sub: 'Tenant admins, FDEs and end users' },
  { id: 'audit', label: 'Audit log', icon: FileClock, sub: 'Every approval, publish, consent change and agent action' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function TenantConsole() {
  const { section = 'overview' } = useParams();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [counts, setCounts] = useState<OverviewData['counts']>();

  // Badge counts in the sidebar; refreshed whenever the admin changes section.
  const refreshCounts = useCallback(() => {
    api<OverviewData>('/api/admin/overview')
      .then((d) => setCounts(d.counts))
      .catch(() => undefined);
  }, []);
  useEffect(refreshCounts, [refreshCounts, section]);

  if (!SECTIONS.some((s) => s.id === section)) return <Navigate to="/admin/overview" replace />;
  const current = SECTIONS.find((s) => s.id === section)!;
  const badge = (id: SectionId) => (id === 'approvals' ? counts?.pendingApprovals : id === 'guardrails' ? counts?.openAlerts : undefined);

  return (
    <div className="flex h-full bg-page text-fg">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="border-b border-slate-700/60 px-5 pb-4 pt-5">
          <p className="text-base font-semibold text-white">Manzil</p>
          <p className="text-xs text-slate-400">Tenant admin · {user?.email}</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-3" aria-label="Admin sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/admin/${id}`}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-slate-700/70 font-medium text-white shadow-[inset_3px_0_0_0_theme(colors.sky.400)]' : 'hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon size={15} />
              <span className="flex-1">{label}</span>
              {badge(id) !== undefined && badge(id)! > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${id === 'guardrails' ? 'bg-red-600' : 'bg-slate-600'}`}>
                  {badge(id)}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-slate-700/60 p-3">
          <NavLink to="/builder" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-800 hover:text-white">
            <Workflow size={15} /> Builder (FDE studio)
          </NavLink>
          <NavLink to="/app" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-800 hover:text-white">
            <LayoutDashboard size={15} /> End-user app
          </NavLink>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-800 hover:text-white"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-6">
          <header className="mb-5">
            <h1 className="text-xl font-semibold text-fg">{current.label}</h1>
            <p className="mt-0.5 text-sm text-muted">{current.sub}</p>
          </header>
          {section === 'overview' && <OverviewPage />}
          {section === 'approvals' && <ApprovalsPage onChanged={refreshCounts} />}
          {section === 'models' && <ModelsPage />}
          {section === 'connectors' && <ConnectorsPage />}
          {section === 'guardrails' && <GuardrailsPage onChanged={refreshCounts} />}
          {section === 'people' && <UsersPage />}
          {section === 'audit' && <AuditPage />}
        </div>
      </main>
    </div>
  );
}
