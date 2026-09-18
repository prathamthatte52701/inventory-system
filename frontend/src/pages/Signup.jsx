import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import { useGuard } from '../useGuard';

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
      <div className="card form-narrow">
        <h1>Thanks for signing up</h1>
        <div className="success">Your account is waiting for admin approval. You can log in once an admin approves it.</div>
        <Link to="/login">Back to login</Link>
      </div>
    );

  return (
    <form className="card form-narrow" onSubmit={submit} noValidate>
      <h1>Sign up</h1>
      {error && <div className="error" role="alert">{error}</div>}
      <label>Name<input value={f.name} onChange={set('name')} /></label>
      <label>Email<input type="email" value={f.email} onChange={set('email')} /></label>
      <label>Password<input type="password" value={f.password} onChange={set('password')} /></label>
      <button className="primary" disabled={busy}>Sign up</button>
      <span className="muted">Have an account? <Link to="/login">Log in</Link></span>
    </form>
  );
}
