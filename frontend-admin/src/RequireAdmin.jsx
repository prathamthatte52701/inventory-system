import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

// Everything in this app needs an admin. `user` only ever holds an admin (see AuthContext).
export default function RequireAdmin({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <p>Loading…</p>; // session still being verified: render nothing protected
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
