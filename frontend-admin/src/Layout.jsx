import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChartColumn, LayoutDashboard, LogOut, Package, PencilLine, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from './AuthContext';
import ThemeToggle from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';

const ITEMS = [
  ['/', 'Overview', LayoutDashboard, true], ['/materials', 'Materials', Package], ['/ledger', 'Movement Corrections', PencilLine],
  ['/users', 'Users', Users], ['/audit', 'Audit Log', ScrollText], ['/analytics', 'Analytics', ChartColumn],
];
const APP_URL = import.meta.env.VITE_APP_URL || 'http://localhost:2000'; // the normal user app

const item = ({ isActive }) =>
  cn('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-all',
    isActive
      ? 'bg-primary/15 text-primary shadow-[inset_3px_0_0_var(--accent-primary),0_0_18px_-8px_var(--accent-primary)]'
      : 'text-muted hover:bg-primary/8 hover:text-fg');

// The one shell for this app (a sidebar, unlike the user app's top bar); rendered only inside <RequireAdmin>.
export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="glass shrink-0 border-y-0 border-l-0 md:sticky md:top-0 md:h-screen md:w-64">
        <nav aria-label="Admin navigation" className="flex h-full flex-col gap-1 p-3">
          <strong className="mb-3 flex items-center gap-2 px-2 py-2 text-[15px] font-semibold tracking-tight text-fg">
            <ShieldCheck className="h-5 w-5 text-primary drop-shadow-[0_0_6px_var(--accent-primary)]" aria-hidden="true" />Admin Console
            <span className="tech-label rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">Admin</span>
          </strong>
          <div className="flex flex-col gap-1 max-md:flex-row max-md:flex-wrap">
            {ITEMS.map(([to, name, Icon, end]) => (
              <NavLink key={to} to={to} end={end} className={item}><Icon className="h-4 w-4" aria-hidden="true" />{name}</NavLink>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3 max-md:mt-3">
            <a href={APP_URL} className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-primary/8 hover:text-fg">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to app
            </a>
            <div className="flex items-center justify-between gap-2 px-3 py-1">
              <span className="truncate text-xs text-muted">Signed in as <span className="font-medium text-fg">{user.name}</span></span>
              <ThemeToggle />
            </div>
            <button
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-err/10 hover:text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              onClick={async () => { await logout(); nav('/login'); }}
            ><LogOut className="h-4 w-4" aria-hidden="true" />Logout</button>
          </div>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 md:px-8"><div className="mx-auto max-w-6xl"><Outlet /></div></main>
    </div>
  );
}
