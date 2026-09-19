import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ITEMS = [['/admin', 'Overview', true], ['/admin/materials', 'Materials'], ['/admin/ledger', 'Movement Corrections'], ['/admin/users', 'Users'], ['/admin/audit', 'Audit Log'], ['/admin/analytics', 'Analytics']];

// Own shell for everything admin-only; rendered only inside <ProtectedRoute adminOnly>.
export default function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="admin-shell">
      <nav className="navbar admin-nav" aria-label="Admin navigation">
        <strong className="brand">Admin Console</strong>
        {ITEMS.map(([to, name, end]) => <NavLink key={to} to={to} end={end}>{name}</NavLink>)}
        <span className="spacer" />
        <NavLink to="/">← Back to app</NavLink>
        <span className="who">{user.name}</span>
        <button onClick={() => { logout(); nav('/login'); }}>Logout</button>
      </nav>
      <main className="page"><Outlet /></main>
    </div>
  );
}
