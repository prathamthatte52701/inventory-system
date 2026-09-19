import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ITEMS = [['/', 'Overview', true], ['/materials', 'Materials'], ['/ledger', 'Movement Corrections'], ['/users', 'Users'], ['/audit', 'Audit Log'], ['/analytics', 'Analytics']];
const APP_URL = import.meta.env.VITE_APP_URL || 'http://localhost:5173'; // the normal user app

// The one shell for this app; rendered only inside <RequireAdmin>.
export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="admin-shell">
      <nav className="navbar admin-nav" aria-label="Admin navigation">
        <strong className="brand">Admin Console</strong>
        {ITEMS.map(([to, name, end]) => <NavLink key={to} to={to} end={end}>{name}</NavLink>)}
        <span className="spacer" />
        <a href={APP_URL}>← Back to app</a>
        <span className="who">{user.name}</span>
        <button onClick={async () => { await logout(); nav('/login'); }}>Logout</button>
      </nav>
      <main className="page"><Outlet /></main>
    </div>
  );
}
