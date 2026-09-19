import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg, fmt, parseNum, MAX_NUM } from '../api';
import { useGuard } from '../useGuard';
import { useAuth } from '../AuthContext';

const day = (d) => String(d).slice(0, 10);
const PAGE_SIZE = 200; // backend MAX_LIMIT; the UI pages through the rest

export default function Ledger() {
  const { isAdmin } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  const [error, setError] = useState('');
  const [run] = useGuard();
  const [edit, setEdit] = useState(null); // { id, type, quantity, rate, date, origDate, note }

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

  const startEdit = (m) => setEdit({
    id: m._id, type: m.type, quantity: String(m.quantity), rate: m.enteredRate == null ? '' : String(m.enteredRate),
    date: day(m.movementDate), origDate: day(m.movementDate), note: m.note || '',
  });
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  const save = () => run(async () => {
    setError('');
    const quantity = parseNum(edit.quantity, 0.0001);
    if (Number.isNaN(quantity)) return setError(`Quantity must be a number greater than 0 and at most ${fmt(MAX_NUM)}`);
    const body = { type: edit.type, quantity, note: edit.note };
    if (edit.type === 'IN') {
      const rate = parseNum(edit.rate, 0);
      if (Number.isNaN(rate)) return setError('Rate is required for IN');
      body.enteredRate = rate;
    }
    if (edit.date !== edit.origDate) {
      if (!edit.date) return setError('Please pick a date');
      body.movementDate = edit.date; // untouched date keeps its original time/order
    }
    try {
      await api.put(`/movements/${edit.id}`, body);
      setEdit(null);
      await load(); // recalculation touches later rows too, so reload the whole table
    } catch (err) {
      setError(errMsg(err));
    }
  });

  return (
    <>
      <h1>Ledger</h1>
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
          <th className="num">Amount</th><th className="num">Balance</th><th>By</th><th>Note</th>{isAdmin && <th>Actions</th>}
        </tr></thead>
        <tbody>
          {rows.map((m) => {
            const editing = edit?.id === m._id;
            return (
              <tr key={m._id} data-testid={`row-${m._id}`}>
                <td>{editing ? <input type="date" aria-label="Date" value={edit.date} onChange={set('date')} /> : day(m.movementDate)}</td>
                <td>{m.material?.materialId}</td>
                <td>{editing
                  ? <select aria-label="Type" value={edit.type} onChange={set('type')}><option>IN</option><option>OUT</option><option>RETURN</option></select>
                  : <>{m.type}{m.isEdited && <span className="muted" title="edited"> ✎</span>}{m.exceededStock && <span className="badge OUT_OF_STOCK" title="exceeded stock">exceeded</span>}</>}</td>
                <td className="num">{editing ? <input type="number" step="any" aria-label="Quantity" value={edit.quantity} onChange={set('quantity')} /> : fmt(m.quantity)}</td>
                <td className="num">{editing && edit.type === 'IN'
                  ? <input type="number" step="any" aria-label="Rate" value={edit.rate} onChange={set('rate')} />
                  : `₹${fmt(m.rate)}`}</td>
                <td className="num">₹{fmt(m.amount)}</td>
                <td className="num">{fmt(m.balanceAfter)}</td>
                <td>{m.createdBy?.name}</td>
                <td>{editing ? <input aria-label="Note" value={edit.note} onChange={set('note')} /> : m.note}</td>
                {isAdmin && (
                  <td className="actions">
                    {editing
                      ? <><button className="primary" onClick={save}>Save</button><button onClick={() => setEdit(null)}>Cancel</button></>
                      : <button onClick={() => startEdit(m)} aria-label={`Edit movement ${m._id}`}>Edit</button>}
                  </td>
                )}
              </tr>
            );
          })}
          {!rows.length && loaded && <tr><td colSpan={isAdmin ? 10 : 9} className="muted">No movements yet.</td></tr>}
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
