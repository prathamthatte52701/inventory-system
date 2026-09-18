import { useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ material: '', type: 'IN', quantity: '', rate: '', movementDate: today(), note: '' });

export default function Movement() {
  const [materials, setMaterials] = useState([]);
  const [f, setF] = useState(blank());
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/materials', { params: { active: true } }).then((r) => setMaterials(r.data)).catch((e) => setError(errMsg(e)));
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const selected = materials.find((m) => m._id === f.material);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setResult(null);
    if (!f.material) return setError('Please select a material');
    if (!(Number(f.quantity) > 0)) return setError('Quantity must be greater than 0');
    if (f.type === 'IN' && (f.rate === '' || Number(f.rate) < 0)) return setError('Rate is required for Stock IN');

    setBusy(true);
    try {
      const body = { material: f.material, type: f.type, quantity: Number(f.quantity), movementDate: f.movementDate, note: f.note || undefined };
      if (f.type === 'IN') body.rate = Number(f.rate);
      const { data } = await api.post('/movements', body);
      setResult(data);
      setMaterials((ms) => ms.map((m) => (m._id === data.material._id ? data.material : m)));
      setF({ ...blank(), material: f.material, type: f.type });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Stock Movement</h1>
      <form className="card" onSubmit={submit} noValidate>
        <div className="row">
          <label>Material
            <select value={f.material} onChange={set('material')}>
              <option value="">-- select --</option>
              {materials.map((m) => <option key={m._id} value={m._id}>{m.materialId} — {m.description}</option>)}
            </select>
          </label>
          <label>Type
            <select value={f.type} onChange={set('type')}>
              <option value="IN">IN</option><option value="OUT">OUT</option><option value="RETURN">RETURN</option>
            </select>
          </label>
          <label>Quantity<input type="number" step="any" value={f.quantity} onChange={set('quantity')} /></label>
          {f.type === 'IN' && <label>Rate<input type="number" step="any" value={f.rate} onChange={set('rate')} /></label>}
          <label>Date<input type="date" value={f.movementDate} onChange={set('movementDate')} /></label>
          <label>Note<input value={f.note} onChange={set('note')} /></label>
          <button className="primary" disabled={busy}>Record Movement</button>
        </div>
        {selected && <p className="muted">Available: {fmt(selected.currentQuantity)} {selected.unit} @ ₹{fmt(selected.currentRate)}</p>}
      </form>

      {error && <div className="error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {result && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {result.warning && <div className="warning" role="status">⚠ {result.warning}</div>}
          <div className="success" role="status">
            Recorded {result.movement.type} of {fmt(result.movement.quantity)} {result.material.unit} for {result.material.materialId}
            {' '}(amount ₹{fmt(result.movement.amount)}). New balance: <b data-testid="balance">{fmt(result.movement.balanceAfter)}</b> {result.material.unit}.
          </div>
        </div>
      )}
    </>
  );
}
