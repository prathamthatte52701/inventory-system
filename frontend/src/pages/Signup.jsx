import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api';

export default function Signup() {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/signup', f);
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
    }
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
      <button className="primary">Sign up</button>
      <span className="muted">Have an account? <Link to="/login">Log in</Link></span>
    </form>
  );
}
