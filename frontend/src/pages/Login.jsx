import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { errMsg } from '../api';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, PasswordField, Input } from '@/components/ui/field';

export default function Login() {
  const { user, ready, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [run, busy] = useGuard();

  if (!ready) return null;
  if (user) return <Navigate to="/" replace />; // already signed in (e.g. pressed Back to here)

  const submit = (e) => {
    e.preventDefault();
    return run(async () => {
      setError('');
      if (!email.trim() || !password) return setError('Enter your email and password');
      try {
        await login(email.trim(), password);
        nav('/');
      } catch (err) {
        setError(errMsg(err));
      }
    });
  };

  return (
    <form className="mx-auto mt-12 grid w-full max-w-sm gap-4 glass neon-border rounded-2xl p-8 shadow-[var(--glow-soft)]" onSubmit={submit} noValidate>
      <div className="grid gap-1">
        <Package className="mb-1 h-7 w-7 text-primary" aria-hidden="true" />
        <p className="tech-label neon-text">// secure access</p>
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="text-sm text-muted">Sign in to manage stock and movements.</p>
      </div>
      {error && <Alert variant="error" role="alert">{error}</Alert>}
      <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button variant="default" className="w-full" disabled={busy}>Log in</Button>
      <span className="text-center text-sm text-muted">No account? <Link to="/signup" className="font-medium text-primary hover:underline">Sign up</Link></span>
    </form>
  );
}
