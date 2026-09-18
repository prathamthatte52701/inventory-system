import { useEffect, useState } from 'react';
import api, { downloadFile, errMsg } from '../api';

export default function Reports() {
  const [materials, setMaterials] = useState([]);
  const [f, setF] = useState({ material: '', from: '', to: '' });
  const [msg, setMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/materials').then((r) => setMaterials(r.data)).catch(() => {}); }, []);

  const run = async (path, params) => {
    setMsg(null); setBusy(true);
    try {
      const { name, size } = await downloadFile(path, params);
      setMsg({ ok: true, text: `Downloaded ${name} (${size} bytes)` });
    } catch (e) {
      // error bodies arrive as a Blob in blob mode; read the JSON message out of it
      let text = errMsg(e);
      if (e.response?.data instanceof Blob) {
        try { text = JSON.parse(await e.response.data.text()).message || text; } catch { /* keep default */ }
      }
      setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));

  return (
    <>
      <h1>Reports</h1>
      <section className="card">
        <h2>Stock value</h2>
        <div className="row">
          <button disabled={busy} onClick={() => run('/reports/stock-value/excel')}>Download Stock Value (Excel)</button>
          <button disabled={busy} onClick={() => run('/reports/stock-value/pdf')}>Download Stock Value (PDF)</button>
        </div>
      </section>
      <section className="card">
        <h2>Movement history</h2>
        <div className="row">
          <label>Material
            <select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })}>
              <option value="">All materials</option>
              {materials.map((m) => <option key={m._id} value={m._id}>{m.materialId} — {m.description}</option>)}
            </select>
          </label>
          <label>From<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label>To<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <button disabled={busy} onClick={() => run('/reports/movements/excel', params)}>Download Movement History (Excel)</button>
        </div>
      </section>
      {msg && <div className={msg.ok ? 'success' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
    </>
  );
}
