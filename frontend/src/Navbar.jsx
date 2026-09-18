import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

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
      {isAdmin && <NavLink to="/users">Users</NavLink>}
      <span className="spacer" />
      <span className="who">{user.name}{isAdmin ? ' (admin)' : ''}</span>
      <button onClick={() => { logout(); nav('/login'); }}>Logout</button>
    </nav>
  );
}
