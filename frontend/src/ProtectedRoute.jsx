import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Loading } from '@/components/ui/page';

export default function ProtectedRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />; // session still being verified: render nothing protected
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
