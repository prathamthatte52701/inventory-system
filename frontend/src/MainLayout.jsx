import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import { useAuth } from './AuthContext';
import ThemeToggle from '@/components/ThemeToggle';
import { AuthBackdrop } from '@/components/ui/auth-backdrop';

export default function MainLayout() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen">
      {user ? <Navbar /> : (
        // logged out (login / signup): circuit backdrop + a theme toggle that is always reachable
        <>
          <AuthBackdrop />
          <div className="fixed right-4 top-4 z-30"><ThemeToggle /></div>
        </>
      )}
      <main className="relative z-10 mx-auto max-w-6xl px-4 py-8"><Outlet /></main>
    </div>
  );
}
