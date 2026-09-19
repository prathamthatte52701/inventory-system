import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api, { errMsg, fmt } from '../api';
import { Alert } from '@/components/ui/alert';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader, Section, StatCard, StatGrid } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const TYPES = ['IN', 'OUT', 'RETURN'];
// same palette as the badges/alerts (Tailwind emerald / red / sky), so charts read as part of the page
const COLORS = { IN: '#10b981', OUT: '#ef4444', RETURN: '#0ea5e9' };
const AXIS = { fontSize: 12, fill: '#64748b' };

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
      <PageHeader title="Analytics" description="Movement volume and the materials that move the most." />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From"><Input type="date" value={range.from} onChange={set('from')} /></Field>
        <Field label="To"><Input type="date" value={range.to} onChange={set('to')} /></Field>
        <Field label="Group by">
          <Select value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="day">Day</option><option value="week">Week</option></Select>
        </Field>
        <Field label="Measure">
          <Select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="amount">Value (₹)</option><option value="quantity">Quantity</option></Select>
        </Field>
      </div>
      {!valid && <Alert variant="warning" role="alert" className="mb-4">Pick a valid date range (From must not be after To).</Alert>}
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}

      {vol && (
        <>
          <StatGrid data-testid="volume-totals" className="lg:grid-cols-3">
            {TYPES.map((t) => <StatCard key={t} value={vol.totals[t].count} label={`${t} movements · ₹${fmt(vol.totals[t].amount)}`} testId={`total-${t}`} />)}
          </StatGrid>
          <Card className="mt-6 p-5">
            <CardTitle>Movement volume ({metric === 'amount' ? '₹' : 'qty'} per {bucket})</CardTitle>
            {chartData.length ? (
              <div style={{ width: '100%', height: 300 }} data-testid="volume-chart" className="mt-4">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 300 }}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="bucket" tick={AXIS} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    {TYPES.map((t) => <Bar key={t} dataKey={t} fill={COLORS[t]} radius={[3, 3, 0, 0]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="mt-3 text-sm text-slate-500" data-testid="volume-empty">No movements in this date range.</p>}
          </Card>
        </>
      )}

      {top && (
        <Section title={`Top materials by ${metric === 'amount' ? 'value' : 'quantity'}`}>
          <TableWrap>
            <Table>
              <thead><tr><Th>#</Th><Th>Material</Th><Th>Description</Th><Th num>Movements</Th><Th num>Quantity</Th><Th num>Value</Th></tr></thead>
              <tbody>
                {top.data.map((m, i) => (
                  <Tr key={m.material} data-testid={`top-${m.materialId}`}>
                    <Td className="text-slate-500">{i + 1}</Td><Td className="font-medium">{m.materialId}</Td><Td>{m.description}</Td>
                    <Td num>{m.movements}</Td><Td num>{fmt(m.quantity)} {m.unit}</Td><Td num>₹{fmt(m.amount)}</Td>
                  </Tr>
                ))}
                {!top.data.length && <EmptyRow cols={6}>No movements in this date range.</EmptyRow>}
              </tbody>
            </Table>
          </TableWrap>
        </Section>
      )}
    </>
  );
}
