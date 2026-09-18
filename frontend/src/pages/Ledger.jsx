import { useCallback, useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';
import { useAuth } from '../AuthContext';

const day = (d) => String(d).slice(0, 10);

export default function Ledger() {
  const { isAdmin } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null); // { id, type, quantity, rate, date, origDate, note }

  useEffect(() => { api.get('/materials').then((r) => setMaterials(r.data)).catch((e) => setError(errMsg(e))); }, []);
  const load = useCallback(
    () => api.get('/movements', { params: filter ? { material: filter } : {} }).then((r) => setRows(r.data)).catch((e) => setError(errMsg(e))),
    [filter]
  );
  useEffect(() => { load(); }, [load]);

  const startEdit = (m) => setEdit({
    id: m._id, type: m.type, quantity: String(m.quantity), rate: m.enteredRate == null ? '' : String(m.enteredRate),
    date: day(m.movementDate), origDate: day(m.movementDate), note: m.note || '',
  });
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  const save = async () => {
    setError('');
    if (!(Number(edit.quantity) > 0)) return setError('Quantity must be greater than 0');
    if (edit.type === 'IN' && (edit.rate === '' || Number(edit.rate) < 0)) return setError('Rate is required for IN');
    const body = { type: edit.type, quantity: Number(edit.quantity), note: edit.note };
    if (edit.type === 'IN') body.enteredRate = Number(edit.rate);
    if (edit.date !== edit.origDate) body.movementDate = edit.date; // untouched date keeps its original time/order
    try {
      await api.put(`/movements/${edit.id}`, body);
      setEdit(null);
      await load(); // recalculation touches later rows too, so reload the whole table
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <>
      <h1>Ledger</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <label>Filter by material
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
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
          {!rows.length && <tr><td colSpan={isAdmin ? 10 : 9} className="muted">No movements yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
