import { useCallback, useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';

const LABEL = { AVAILABLE: 'Available', LOW_STOCK: 'Low Stock', OUT_OF_STOCK: 'Out of Stock' };

export default function Materials() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('/materials').then((r) => setItems(r.data)).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h1>Material Master</h1>
      {error && <div className="error" role="alert">{error}</div>}

      <table>
        <thead><tr>
          <th>Material ID</th><th>Description</th><th>Unit</th><th className="num">Current Qty</th><th className="num">Rate</th>
          <th className="num">Min Qty</th><th>Status</th>
        </tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m._id} className={m.isActive ? '' : 'muted'}>
              <td>{m.materialId}{!m.isActive && ' (inactive)'}</td><td>{m.description}</td><td>{m.unit}</td>
              <td className="num">{fmt(m.currentQuantity)}</td><td className="num">₹{fmt(m.currentRate)}</td>
              <td className="num">{fmt(m.minimumQuantity)}</td>
              <td><span className={`badge ${m.status}`}>{LABEL[m.status]}</span></td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan="7" className="muted">No materials yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
