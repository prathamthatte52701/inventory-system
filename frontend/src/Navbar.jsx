import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

// The admin console is a separate app; its address is configurable (see frontend/.env.example).
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || 'http://localhost:5174';

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <nav className="navbar">
      <strong className="brand">Inventory</strong>
      <NavLink to="/" end>Dashboard</NavLink>
      <NavLink to="/materials">Materials</NavLink>
      <NavLink to="/movement">Stock Movement</NavLink>
      <NavLink to="/ledger">Ledger</NavLink>
      <NavLink to="/reports">Reports</NavLink>
      {isAdmin && <a href={ADMIN_URL} target="_blank" rel="noopener noreferrer">Admin</a>}
      <span className="spacer" />
      <span className="who">{user.name}{isAdmin ? ' (admin)' : ''}</span>
      <button onClick={async () => { await logout(); nav('/login'); }}>Logout</button>
    </nav>
  );
}
