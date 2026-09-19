import { Fragment, useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../api';
import { useGuard } from '../useGuard';
import { useAuth } from '../AuthContext';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [run] = useGuard();
  const [open, setOpen] = useState(null); // { id, activity | null } for the expanded user

  const load = useCallback(() => api.get('/users').then((r) => setUsers(r.data)).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  const act = (fn) => run(async () => {
    setError('');
    try { await fn(); await load(); } catch (e) { setError(errMsg(e)); }
  });
  const toggleDetails = async (u) => {
    if (open?.id === u._id) return setOpen(null);
    setOpen({ id: u._id, activity: null });
    try {
      const { data } = await api.get(`/users/${u._id}/activity`);
      setOpen((o) => (o?.id === u._id ? { id: u._id, activity: data } : o)); // ignore if another row was opened meanwhile
    } catch (e) { setError(errMsg(e)); setOpen(null); }
  };
  const pending = users.filter((u) => u.status === 'pending');

  return (
    <>
      <h1>Users</h1>
      {error && <div className="error" role="alert">{error}</div>}

      <section>
        <h2>Pending signups</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Requested</th><th>Actions</th></tr></thead>
          <tbody>
            {pending.map((u) => (
              <tr key={u._id}>
                <td>{u.name}</td><td>{u.email}</td><td>{String(u.createdAt).slice(0, 10)}</td>
                <td className="actions">
                  <button className="primary" onClick={() => act(() => api.patch(`/users/${u._id}/approve`))} aria-label={`Approve ${u.email}`}>Approve</button>
                  <button className="danger" onClick={() => act(() => api.patch(`/users/${u._id}/reject`))} aria-label={`Reject ${u.email}`}>Reject</button>
                </td>
              </tr>
            ))}
            {!pending.length && <tr><td colSpan="4" className="muted">No pending signups.</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2>All users</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u._id === me.id;
              const next = u.role === 'admin' ? 'user' : 'admin';
              return (
                <Fragment key={u._id}>
                  <tr>
                    <td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td>
                    <td className="actions">
                      <button disabled={self} title={self ? 'You cannot change your own role' : ''}
                        onClick={() => act(() => api.patch(`/users/${u._id}/role`, { role: next }))} aria-label={`Make ${u.email} ${next}`}>
                        Make {next}
                      </button>
                      <button onClick={() => toggleDetails(u)} aria-expanded={open?.id === u._id} aria-label={`Details for ${u.email}`}>
                        {open?.id === u._id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {open?.id === u._id && (
                    <tr data-testid={`activity-${u._id}`}><td colSpan="5" className="muted">
                      {open.activity
                        ? <>Movements created: <b>{open.activity.movementCount}</b>{open.activity.lastMovementAt && <> · last on {String(open.activity.lastMovementAt).slice(0, 10)}</>}</>
                        : 'Loading…'}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
