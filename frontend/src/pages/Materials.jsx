import { useCallback, useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';
import { useAuth } from '../AuthContext';

const LABEL = { AVAILABLE: 'Available', LOW_STOCK: 'Low Stock', OUT_OF_STOCK: 'Out of Stock' };
const EMPTY = { materialId: '', description: '', unit: '', openingRate: '0', openingQuantity: '0', minimumQuantity: '0' };

export default function Materials() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // null = closed; { _id? , ...fields }

  const load = useCallback(() => api.get('/materials').then((r) => setItems(r.data)).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const { _id, materialId, ...rest } = form;
    try {
      if (_id) await api.put(`/materials/${_id}`, rest);
      else await api.post('/materials', { materialId, ...rest });
      setForm(null);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const toggle = async (m) => {
    setError('');
    try { await api.patch(`/materials/${m._id}/${m.isActive ? 'deactivate' : 'reactivate'}`); load(); } catch (err) { setError(errMsg(err)); }
  };
  const edit = (m) => setForm({
    _id: m._id, materialId: m.materialId, description: m.description, unit: m.unit,
    openingRate: String(m.openingRate), openingQuantity: String(m.openingQuantity), minimumQuantity: String(m.minimumQuantity),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="row"><h1 style={{ flex: 1 }}>Material Master</h1>
        {isAdmin && !form && <button className="primary" onClick={() => setForm({ ...EMPTY })}>Add Material</button>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      {isAdmin && form && (
        <form className="card row" onSubmit={save} noValidate style={{ marginBottom: 16 }}>
          <label>Material ID<input value={form.materialId} onChange={set('materialId')} disabled={!!form._id} /></label>
          <label>Description<input value={form.description} onChange={set('description')} /></label>
          <label>Unit<input value={form.unit} onChange={set('unit')} /></label>
          <label>Opening Rate<input type="number" step="any" value={form.openingRate} onChange={set('openingRate')} /></label>
          <label>Opening Quantity<input type="number" step="any" value={form.openingQuantity} onChange={set('openingQuantity')} /></label>
          <label>Minimum Quantity<input type="number" step="any" value={form.minimumQuantity} onChange={set('minimumQuantity')} /></label>
          <button className="primary">Save</button>
          <button type="button" onClick={() => setForm(null)}>Cancel</button>
        </form>
      )}

      <table>
        <thead><tr>
          <th>Material ID</th><th>Description</th><th>Unit</th><th className="num">Current Qty</th><th className="num">Rate</th>
          <th className="num">Min Qty</th><th>Status</th>{isAdmin && <th>Actions</th>}
        </tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m._id} className={m.isActive ? '' : 'muted'}>
              <td>{m.materialId}{!m.isActive && ' (inactive)'}</td><td>{m.description}</td><td>{m.unit}</td>
              <td className="num">{fmt(m.currentQuantity)}</td><td className="num">₹{fmt(m.currentRate)}</td>
              <td className="num">{fmt(m.minimumQuantity)}</td>
              <td><span className={`badge ${m.status}`}>{LABEL[m.status]}</span></td>
              {isAdmin && (
                <td className="actions">
                  <button onClick={() => edit(m)} aria-label={`Edit ${m.materialId}`}>Edit</button>
                  <button className={m.isActive ? 'danger' : ''} onClick={() => toggle(m)} aria-label={`${m.isActive ? 'Deactivate' : 'Reactivate'} ${m.materialId}`}>
                    {m.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!items.length && <tr><td colSpan={isAdmin ? 8 : 7} className="muted">No materials yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
