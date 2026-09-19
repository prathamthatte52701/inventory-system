import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg, fmt } from '../api';

const day = (d) => String(d).slice(0, 10);
const PAGE_SIZE = 200; // backend MAX_LIMIT; the UI pages through the rest

// Read-only ledger for the normal user app. Corrections (editing a movement) live in the separate admin app.
export default function LedgerTable({ title = 'Ledger' }) {
  const [materials, setMaterials] = useState([]);
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  const [error, setError] = useState('');

  useEffect(() => { api.get('/materials').then((r) => setMaterials(r.data)).catch((e) => setError(errMsg(e))); }, []);
  const load = useCallback(() => {
    const seq = ++latest.current; // drop responses from superseded filter/page requests
    return api.get('/movements', { params: { page, limit: PAGE_SIZE, ...(filter ? { material: filter } : {}) } })
      .then((r) => {
        if (seq !== latest.current) return;
        const { data, total, totalPages } = r.data;
        if (!data.length && page > 1 && totalPages) return setPage(totalPages); // page vanished: step back
        setRows(data); setMeta({ total, totalPages }); setLoaded(true);
      })
      .catch((e) => { if (seq === latest.current) setError(errMsg(e)); });
  }, [filter, page]);
  useEffect(() => { load(); }, [load]);
  const pickFilter = (v) => { setFilter(v); setPage(1); };

  return (
    <>
      <h1>{title}</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <label>Filter by material
          <select value={filter} onChange={(e) => pickFilter(e.target.value)}>
            <option value="">All materials</option>
            {materials.map((m) => <option key={m._id} value={m._id}>{m.materialId} — {m.description}</option>)}
          </select>
        </label>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <table>
        <thead><tr>
          <th>Date</th><th>Material ID</th><th>Type</th><th className="num">Qty</th><th className="num">Rate</th>
          <th className="num">Amount</th><th className="num">Balance</th><th>By</th><th>Note</th>
        </tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m._id} data-testid={`row-${m._id}`}>
              <td>{day(m.movementDate)}</td>
              <td>{m.material?.materialId}</td>
              <td>{m.type}{m.isEdited && <span className="muted" title="edited"> ✎</span>}{m.exceededStock && <span className="badge OUT_OF_STOCK" title="exceeded stock">exceeded</span>}</td>
              <td className="num">{fmt(m.quantity)}</td>
              <td className="num">₹{fmt(m.rate)}</td>
              <td className="num">₹{fmt(m.amount)}</td>
              <td className="num">{fmt(m.balanceAfter)}</td>
              <td>{m.createdBy?.name}</td>
              <td>{m.note}</td>
            </tr>
          ))}
          {!rows.length && loaded && <tr><td colSpan={9} className="muted">No movements yet.</td></tr>}
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
