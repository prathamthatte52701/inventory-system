import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export default function Signup() {
  const { user, ready } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [run, busy] = useGuard();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (!ready) return null;
  if (user) return <Navigate to="/" replace />;

  const submit = (e) => {
    e.preventDefault();
    return run(async () => {
      setError('');
      if (!f.name.trim() || !f.email.trim() || !f.password) return setError('Name, email and password are required');
      if (f.password.length < 6) return setError('Password must be at least 6 characters');
      try {
        await api.post('/auth/signup', { ...f, name: f.name.trim(), email: f.email.trim() });
        setDone(true);
      } catch (err) {
        setError(errMsg(err));
      }
    });
  };

  if (done)
    return (
      <div className="mx-auto mt-12 grid w-full max-w-sm gap-4 glass neon-border rounded-2xl p-8 shadow-[var(--glow-soft)]">
        <h1 className="text-2xl font-semibold tracking-tight">Thanks for signing up</h1>
        <Alert variant="success">Your account is waiting for admin approval. You can log in once an admin approves it.</Alert>
        <Link to="/login" className="text-sm font-medium text-primary hover:underline">Back to login</Link>
      </div>
    );

  return (
    <form className="mx-auto mt-12 grid w-full max-w-sm gap-4 glass neon-border rounded-2xl p-8 shadow-[var(--glow-soft)]" onSubmit={submit} noValidate>
      <div className="grid gap-1">
        <Package className="mb-1 h-7 w-7 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
        <p className="text-sm text-muted">An admin has to approve your account before you can log in.</p>
      </div>
      {error && <Alert variant="error" role="alert">{error}</Alert>}
      <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Password"><Input type="password" value={f.password} onChange={set('password')} /></Field>
      <Button variant="default" className="w-full" disabled={busy}>Sign up</Button>
      <span className="text-center text-sm text-muted">Have an account? <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link></span>
    </form>
  );
}
