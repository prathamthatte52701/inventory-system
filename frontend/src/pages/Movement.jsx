import { useEffect, useState } from 'react';
import api, { errMsg, fmt, parseNum, MAX_NUM } from '../api';
import { useGuard } from '../useGuard';

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ material: '', type: 'IN', quantity: '', rate: '', movementDate: today(), note: '' });

export default function Movement() {
  const [materials, setMaterials] = useState([]);
  const [f, setF] = useState(blank());
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [run, busy] = useGuard();

  useEffect(() => {
    api.get('/materials', { params: { active: true } }).then((r) => setMaterials(r.data)).catch((e) => setError(errMsg(e)));
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const selected = materials.find((m) => m._id === f.material);

  const submit = (e) => {
    e.preventDefault();
    return run(async () => {
      setError(''); setResult(null);
      if (!f.material) return setError('Please select a material');
      const quantity = parseNum(f.quantity, 0.0001);
      if (Number.isNaN(quantity)) return setError(`Quantity must be a number greater than 0 and at most ${fmt(MAX_NUM)}`);
      let rate;
      if (f.type === 'IN') {
        rate = parseNum(f.rate, 0);
        if (Number.isNaN(rate)) return setError(`Rate is required for Stock IN (0 to ${fmt(MAX_NUM)})`);
      }
      if (!f.movementDate) return setError('Please pick a date');
      try {
        const body = { material: f.material, type: f.type, quantity, movementDate: f.movementDate, note: f.note || undefined };
        if (f.type === 'IN') body.rate = rate;
        const { data } = await api.post('/movements', body);
        setResult(data);
        setMaterials((ms) => ms.map((m) => (m._id === data.material._id ? data.material : m)));
        setF({ ...blank(), material: f.material, type: f.type });
      } catch (err) {
        setError(errMsg(err));
      }
    });
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
