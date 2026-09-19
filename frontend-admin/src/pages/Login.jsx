import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { errMsg } from '../api';
import { useGuard } from '../useGuard';

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
    <form className="card form-narrow" onSubmit={submit} noValidate>
      <h1>Admin sign in</h1>
      {denied && !error && <div className="error" role="alert">This app is for admins only</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="primary" disabled={busy}>Sign in</button>
    </form>
  );
}
