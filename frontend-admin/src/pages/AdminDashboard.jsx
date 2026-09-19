import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api';

const LINKS = [
  ['/materials', 'Materials', 'Add, edit, deactivate'],
  ['/ledger', 'Movement Corrections', 'Fix a ledger entry'],
  ['/users', 'Users', 'Approvals and roles'],
  ['/audit', 'Audit Log', 'Who did what'],
  ['/analytics', 'Analytics', 'Volume and top materials'],
];

export default function AdminDashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/users', { params: { status: 'pending' } }), api.get('/reports/dashboard'), api.get('/audit', { params: { limit: 5 } })])
      .then(([u, r, a]) => setD({ pending: u.data.length, low: r.data.lowStockCount, out: r.data.outOfStockCount, recent: a.data.data }))
      .catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!d) return <p>Loading…</p>;
  return (
    <>
      <h1>Admin Overview</h1>
      <div className="stats">
        <Link to="/users" className="card stat" aria-label="Pending signups"><b data-testid="pending-count">{d.pending}</b><span>Pending signups — review</span></Link>
        <div className="card stat"><b data-testid="low-count">{d.low}</b><span>Low stock</span></div>
        <div className="card stat"><b data-testid="out-count">{d.out}</b><span>Out of stock</span></div>
      </div>
      <section>
        <h2>Recent activity</h2>
        <table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>
            {d.recent.map((a) => <tr key={a._id}><td>{new Date(a.createdAt).toLocaleString()}</td><td>{a.userEmail}</td><td>{a.action}</td><td>{a.entityType}</td></tr>)}
            {!d.recent.length && <tr><td colSpan="4" className="muted">No activity yet.</td></tr>}
          </tbody>
        </table>
        <p><Link to="/audit">Full audit log →</Link></p>
      </section>
      <section>
        <h2>Quick links</h2>
        <div className="stats">
          {LINKS.map(([to, name, hint]) => <Link key={to} to={to} className="card stat"><b style={{ fontSize: 18 }}>{name}</b><span>{hint}</span></Link>)}
        </div>
      </section>
    </>
  );
}
