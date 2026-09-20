import { NavLink, useNavigate } from 'react-router-dom';
import { ExternalLink, Package } from 'lucide-react';
import { useAuth } from './AuthContext';
import ThemeToggle from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The admin console is a separate app; its address is configurable (see frontend/.env.example).
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || 'http://localhost:5174';

const link = ({ isActive }) =>
  cn('rounded-md px-3 py-1.5 text-sm font-medium transition-all',
    isActive
      ? 'bg-primary/10 text-primary shadow-[inset_0_-2px_0_var(--accent-primary),0_6px_14px_-8px_var(--accent-primary)]'
      : 'text-muted hover:bg-primary/8 hover:text-fg');

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-1 px-4 py-2">
        <strong className="mr-4 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
          <Package className="h-5 w-5 text-primary drop-shadow-[0_0_6px_var(--accent-primary)]" aria-hidden="true" />
          Inventory<span className="neon-text">.AI</span>
        </strong>
        <NavLink to="/" end className={link}>Dashboard</NavLink>
        <NavLink to="/materials" className={link}>Materials</NavLink>
        <NavLink to="/movement" className={link}>Stock Movement</NavLink>
        <NavLink to="/ledger" className={link}>Ledger</NavLink>
        <NavLink to="/reports" className={link}>Reports</NavLink>
        {isAdmin && (
          <a href={ADMIN_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-accent2 transition-colors hover:bg-accent2/10">
            Admin<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        <span className="flex-1" />
        <span className="text-sm text-muted">{user.name}{isAdmin ? ' (admin)' : ''}</span>
        <ThemeToggle className="ml-2" />
        <Button variant="ghost" size="sm" onClick={async () => { await logout(); nav('/login'); }}>Logout</Button>
      </nav>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" aria-hidden="true" />
    </header>
  );
}
