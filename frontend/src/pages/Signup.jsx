import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordField } from '@/components/ui/field';
import { nameProblem, emailProblem, passwordProblem, passwordStrength } from '../validation';

export default function Signup() {
  const { user, ready } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [run, busy] = useGuard();
  const [touched, setTouched] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  if (!ready) return null;
  if (user) return <Navigate to="/" replace />;

  const problems = { name: nameProblem(f.name), email: emailProblem(f.email), password: passwordProblem(f.password) };
  const shown = (k) => (touched[k] ? problems[k] : null);
  const aria = (k) => ({ 'aria-invalid': !!shown(k), 'aria-describedby': shown(k) ? `signup-${k}-err` : undefined });
  const Err = ({ k }) => (shown(k) ? <span id={`signup-${k}-err`} className="text-xs text-err">{shown(k)}</span> : null);
  const strength = passwordStrength(f.password);
  const tone = { 1: 'bg-err', 2: 'bg-warn', 3: 'bg-ok' };

  const submit = (e) => {
    e.preventDefault();
    return run(async () => {
      setError('');
      setTouched({ name: true, email: true, password: true });
      if (!f.name.trim() && !f.email.trim() && !f.password) return setError('Name, email and password are required');
      const first = nameProblem(f.name) || emailProblem(f.email) || passwordProblem(f.password);
      if (first) return setError(first);
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
      <div className="grid gap-1">
        <Field label="Name"><Input value={f.name} onChange={set('name')} onBlur={blur('name')} {...aria('name')} /></Field>
        <Err k="name" />
      </div>
      <div className="grid gap-1">
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} onBlur={blur('email')} {...aria('email')} /></Field>
        <Err k="email" />
      </div>
      <div className="grid gap-1">
        <PasswordField label="Password" value={f.password} onChange={set('password')} onBlur={blur('password')} error={!!shown('password')} {...aria('password')} />
        <Err k="password" />
        {f.password && (
          <div className="flex items-center gap-2" data-testid="password-strength">
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= strength.level ? tone[strength.level] : 'bg-fg/10'}`} />
              ))}
            </div>
            <span className="tech-label text-xs text-muted">{strength.label}</span>
          </div>
        )}
      </div>
      <Button variant="default" className="w-full" disabled={busy}>Sign up</Button>
      <span className="text-center text-sm text-muted">Have an account? <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link></span>
    </form>
  );
}
