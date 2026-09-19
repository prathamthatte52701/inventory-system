import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api, { errMsg, fmt } from '../../api';

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const TYPES = ['IN', 'OUT', 'RETURN'];
const COLORS = { IN: '#059669', OUT: '#dc2626', RETURN: '#2563eb' };

export default function AdminAnalytics() {
  const [range, setRange] = useState({ from: isoDay(Date.now() - 29 * 864e5), to: isoDay(Date.now()) });
  const [bucket, setBucket] = useState('day');
  const [metric, setMetric] = useState('amount');
  const [vol, setVol] = useState(null);
  const [top, setTop] = useState(null);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const valid = !!(range.from && range.to && range.from <= range.to);
  useEffect(() => {
    if (!valid) return;
    const seq = ++latest.current; // the date range is queried server-side; late responses from an older range are dropped
    setError('');
    Promise.all([
      api.get('/analytics/volume', { params: { ...range, bucket } }),
      api.get('/analytics/top-materials', { params: { ...range, by: metric === 'amount' ? 'value' : 'quantity', limit: 10 } }),
    ]).then(([v, t]) => { if (seq === latest.current) { setVol(v.data); setTop(t.data); } })
      .catch((e) => { if (seq === latest.current) setError(errMsg(e)); });
  }, [range, bucket, metric, valid]);

  const chartData = (vol?.buckets || []).map((b) => ({ bucket: b.bucket, ...Object.fromEntries(TYPES.map((t) => [t, b[t]?.[metric] || 0])) }));
  const set = (k) => (e) => setRange({ ...range, [k]: e.target.value });

  return (
    <>
      <h1>Analytics</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <label>From<input type="date" value={range.from} onChange={set('from')} /></label>
        <label>To<input type="date" value={range.to} onChange={set('to')} /></label>
        <label>Group by
          <select value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="day">Day</option><option value="week">Week</option></select>
        </label>
        <label>Measure
          <select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="amount">Value (₹)</option><option value="quantity">Quantity</option></select>
        </label>
      </div>
      {!valid && <div className="warning" role="alert">Pick a valid date range (From must not be after To).</div>}
      {error && <div className="error" role="alert">{error}</div>}

      {vol && (
        <>
          <div className="stats" data-testid="volume-totals">
            {TYPES.map((t) => (
              <div className="card stat" key={t}>
                <b data-testid={`total-${t}`}>{vol.totals[t].count}</b><span>{t} movements · ₹{fmt(vol.totals[t].amount)}</span>
              </div>
            ))}
          </div>
          <section className="card">
            <h2>Movement volume ({metric === 'amount' ? '₹' : 'qty'} per {bucket})</h2>
            {chartData.length ? (
              <div style={{ width: '100%', height: 300 }} data-testid="volume-chart">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 300 }}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="bucket" /><YAxis /><Tooltip /><Legend />
                    {TYPES.map((t) => <Bar key={t} dataKey={t} fill={COLORS[t]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="muted" data-testid="volume-empty">No movements in this date range.</p>}
          </section>
        </>
      )}

      {top && (
        <section>
          <h2>Top materials by {metric === 'amount' ? 'value' : 'quantity'}</h2>
          <table>
            <thead><tr><th>#</th><th>Material</th><th>Description</th><th className="num">Movements</th><th className="num">Quantity</th><th className="num">Value</th></tr></thead>
            <tbody>
              {top.data.map((m, i) => (
                <tr key={m.material} data-testid={`top-${m.materialId}`}>
                  <td>{i + 1}</td><td>{m.materialId}</td><td>{m.description}</td>
                  <td className="num">{m.movements}</td><td className="num">{fmt(m.quantity)} {m.unit}</td><td className="num">₹{fmt(m.amount)}</td>
                </tr>
              ))}
              {!top.data.length && <tr><td colSpan="6" className="muted">No movements in this date range.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
