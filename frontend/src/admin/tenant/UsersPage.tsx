import { Trash2, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/useAuthStore';
import { NoticeBar, Pill, Section, btn, btnPrimary, field, when, useActions, useLoad } from './ui';

interface UserRow {
  id: string;
  email: string;
  role: 'admin' | 'fde' | 'user';
  created_at: string;
}

const ROLE_TONE = { admin: 'info', fde: 'warn', user: 'off' } as const;
const ROLE_LABEL = { admin: 'Tenant admin', fde: 'FDE (builder)', user: 'End user' } as const;

export function UsersPage() {
  const me = useAuthStore((s) => s.user);
  const { data, error, reload } = useLoad<UserRow[]>('/api/admin/users');
  const { notice, busy, run } = useActions(reload);
  const [form, setForm] = useState({ email: '', password: '', role: 'user' });

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    void run('create', async () => {
      await api('/api/admin/users', { body: form });
      const made = form.email;
      setForm({ email: '', password: '', role: 'user' });
      return `Created ${made}.`;
    });
  };

  return (
    <div className="space-y-5">
      <NoticeBar notice={notice} />
      <Section
        title="Users"
        description="Tenant admins govern and approve. FDEs build and submit workflows. End users only see the app: Dashboard, Chat, AI Activity and Analytics."
      >
        <form onSubmit={onCreate} className="mb-3 flex flex-wrap gap-2">
          <input className={`${field} flex-1`} type="email" required placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input
            className={`${field} flex-1`}
            type="password"
            required
            minLength={8}
            placeholder="password (8+ characters)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role">
            <option value="user">End user</option>
            <option value="fde">FDE (builder)</option>
            <option value="admin">Tenant admin</option>
          </select>
          <button type="submit" className={btnPrimary} disabled={busy !== null}>
            <UserPlus size={13} /> Add user
          </button>
        </form>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{u.email}</span>
              <span className="hidden text-xs text-subtle sm:inline">since {when(u.created_at)}</span>
              <Pill tone={ROLE_TONE[u.role] ?? 'off'}>{ROLE_LABEL[u.role] ?? u.role}</Pill>
              <button
                type="button"
                className={btn}
                disabled={busy !== null || u.id === me?.id}
                title={u.id === me?.id ? 'You cannot delete your own account' : undefined}
                onClick={() =>
                  window.confirm(`Delete ${u.email}?`) &&
                  void run(`del:${u.id}`, async () => {
                    await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                    return `Deleted ${u.email}.`;
                  })
                }
              >
                <Trash2 size={13} /> Delete
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
