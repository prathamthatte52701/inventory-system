import { NavLink, useNavigate } from 'react-router-dom';
import { ExternalLink, Package } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The admin console is a separate app; its address is configurable (see frontend/.env.example).
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || 'http://localhost:5174';

const link = ({ isActive }) =>
  cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900');

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-1 px-4 py-2">
        <strong className="mr-4 flex items-center gap-2 text-[15px] font-semibold text-slate-900">
          <Package className="h-5 w-5 text-primary" aria-hidden="true" />Inventory
        </strong>
        <NavLink to="/" end className={link}>Dashboard</NavLink>
        <NavLink to="/materials" className={link}>Materials</NavLink>
        <NavLink to="/movement" className={link}>Stock Movement</NavLink>
        <NavLink to="/ledger" className={link}>Ledger</NavLink>
        <NavLink to="/reports" className={link}>Reports</NavLink>
        {isAdmin && (
          <a href={ADMIN_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50">
            Admin<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        <span className="flex-1" />
        <span className="text-sm text-slate-600">{user.name}{isAdmin ? ' (admin)' : ''}</span>
        <Button variant="ghost" size="sm" onClick={async () => { await logout(); nav('/login'); }}>Logout</Button>
      </nav>
    </header>
  );
}
