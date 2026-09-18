import { useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';

const LABEL = { AVAILABLE: 'Available', LOW_STOCK: 'Low Stock', OUT_OF_STOCK: 'Out of Stock' };

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/dashboard').then((r) => setD(r.data)).catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!d) return <p>Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
      <div className="stats">
        <div className="card stat"><b data-testid="total-materials">{d.totalMaterials}</b><span>Total Materials</span></div>
        <div className="card stat"><b data-testid="total-value">₹{fmt(d.totalStockValue)}</b><span>Total Stock Value</span></div>
        <div className="card stat"><b data-testid="low-count">{d.lowStockCount}</b><span>Low Stock</span></div>
        <div className="card stat"><b data-testid="out-count">{d.outOfStockCount}</b><span>Out of Stock</span></div>
      </div>
      <table>
        <thead><tr><th>Material ID</th><th>Description</th><th className="num">Current Qty</th><th className="num">Rate</th><th className="num">Stock Value</th><th>Status</th></tr></thead>
        <tbody>
          {d.materials.map((m) => (
            <tr key={m._id}>
              <td>{m.materialId}</td><td>{m.description}</td>
              <td className="num">{fmt(m.currentQuantity)} {m.unit}</td>
              <td className="num">₹{fmt(m.currentRate)}</td>
              <td className="num">₹{fmt(m.stockValue)}</td>
              <td><span className={`badge ${m.status}`}>{LABEL[m.status]}</span></td>
            </tr>
          ))}
          {!d.materials.length && <tr><td colSpan="6" className="muted">No materials yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
