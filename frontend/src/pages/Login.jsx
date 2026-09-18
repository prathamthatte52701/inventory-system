import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { errMsg } from '../api';
import { useGuard } from '../useGuard';

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
    <form className="card form-narrow" onSubmit={submit} noValidate>
      <h1>Log in</h1>
      {error && <div className="error" role="alert">{error}</div>}
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="primary" disabled={busy}>Log in</button>
      <span className="muted">No account? <Link to="/signup">Sign up</Link></span>
    </form>
  );
}
