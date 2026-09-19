import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../../api';

const ENTITIES = ['Material', 'Movement', 'User'];
const ACTIONS = ['LOGIN', 'LOGOUT', 'SIGNUP', 'MATERIAL_CREATE', 'MATERIAL_UPDATE', 'MOVEMENT_CREATE', 'MOVEMENT_EDIT', 'USER_APPROVE', 'USER_REJECT', 'USER_ROLE_CHANGE'];
const PAGE_SIZE = 50;
const NONE = { entityType: '', action: '', from: '', to: '' };

export default function AdminAudit() {
  const [filters, setFilters] = useState(NONE);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const badRange = !!(filters.from && filters.to && filters.from > filters.to);

  const load = useCallback(() => {
    if (badRange) return undefined; // the API would reject it; the warning below tells the admin why
    const seq = ++latest.current; // drop responses from superseded filter/page requests
    const params = { page, limit: PAGE_SIZE, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
    return api.get('/audit', { params })
      .then((r) => {
        if (seq !== latest.current) return;
        const { data, total, totalPages } = r.data;
        if (!data.length && page > 1 && totalPages) return setPage(totalPages);
        setError(''); setRows(data); setMeta({ total, totalPages }); setLoaded(true);
      })
      .catch((e) => { if (seq === latest.current) setError(errMsg(e)); });
  }, [filters, page, badRange]);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <h1>Audit Log</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <label>Entity type
          <select value={filters.entityType} onChange={set('entityType')}>
            <option value="">All</option>{ENTITIES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label>Action
          <select value={filters.action} onChange={set('action')}>
            <option value="">All</option>{ACTIONS.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label>From<input type="date" value={filters.from} onChange={set('from')} /></label>
        <label>To<input type="date" value={filters.to} onChange={set('to')} /></label>
        <button onClick={() => { setFilters(NONE); setPage(1); }}>Clear</button>
      </div>
      {badRange && <div className="warning" role="alert">"From" is after "To".</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <table>
        <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a._id} data-testid={`audit-${a._id}`}>
              <td><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time></td><td>{a.userEmail}</td><td>{a.action}</td><td>{a.entityType}</td>
              <td className="muted">{a.details && Object.keys(a.details).length ? JSON.stringify(a.details) : ''}</td>
            </tr>
          ))}
          {!rows.length && loaded && <tr><td colSpan="5" className="muted">No audit entries match.</td></tr>}
        </tbody>
      </table>
      {meta.totalPages > 1 && (
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => setPage(page - 1)} disabled={page <= 1}>Prev</button>
          <span data-testid="page-info">Page {page} of {meta.totalPages} ({meta.total} total)</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= meta.totalPages}>Next</button>
        </div>
      )}
    </>
  );
}
