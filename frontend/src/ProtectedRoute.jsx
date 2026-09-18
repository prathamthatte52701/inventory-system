import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, ready, isAdmin } = useAuth();
  if (!ready) return <p>Loading…</p>; // session still being verified: render nothing protected
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}
