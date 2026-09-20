import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { errMsg } from '../api';
import { useGuard } from '../useGuard';
import ThemeToggle from '@/components/ThemeToggle';
import { Alert } from '@/components/ui/alert';
import { AuthBackdrop } from '@/components/ui/auth-backdrop';
import { Button } from '@/components/ui/button';
import { Field, PasswordField, Input } from '@/components/ui/field';

export default function Login() {
  const { user, ready, denied, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [run, busy] = useGuard();

  if (!ready) return null;
  if (user) return <Navigate to="/" replace />; // already signed in as admin

  const submit = (e) => {
    e.preventDefault();
    return run(async () => {
      setError('');
      if (!email.trim() || !password) return setError('Enter your email and password');
      try {
        await login(email.trim(), password);
        nav('/');
      } catch (err) {
        setError(err.response ? errMsg(err) : err.message); // "This app is for admins only" has no HTTP response
      }
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <AuthBackdrop />
      <div className="fixed right-4 top-4 z-30"><ThemeToggle /></div>
      <form className="glass neon-border relative z-10 grid w-full max-w-sm gap-4 rounded-2xl p-8 shadow-[var(--glow-soft)]" onSubmit={submit} noValidate>
        <div className="grid gap-1">
          <ShieldCheck className="mb-1 h-8 w-8 text-primary drop-shadow-[0_0_8px_var(--accent-primary)]" aria-hidden="true" />
          <p className="tech-label neon-text">// secure access</p>
        <h1 className="text-2xl font-semibold tracking-tight">Admin sign in</h1>
          <p className="text-sm text-muted">Restricted to administrators.</p>
        </div>
        {denied && !error && <Alert variant="error" role="alert">This app is for admins only</Alert>}
        {error && <Alert variant="error" role="alert">{error}</Alert>}
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button variant="default" className="w-full" disabled={busy}>Sign in</Button>
      </form>
    </div>
  );
}
