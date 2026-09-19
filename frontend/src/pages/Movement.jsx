import { useEffect, useState } from 'react';
import api, { errMsg, fmt, parseNum, MAX_NUM } from '../api';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page';

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
      <PageHeader title="Stock Movement" description="Record stock coming in, going out, or being returned." />
      <Card>
        <form onSubmit={submit} noValidate className="grid gap-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Material" className="sm:col-span-2 lg:col-span-1">
              <Select value={f.material} onChange={set('material')}>
                <option value="">-- select --</option>
                {materials.map((m) => <option key={m._id} value={m._id}>{m.materialId} — {m.description}</option>)}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={f.type} onChange={set('type')}>
                <option value="IN">IN</option><option value="OUT">OUT</option><option value="RETURN">RETURN</option>
              </Select>
            </Field>
            <Field label="Quantity"><Input type="number" step="any" value={f.quantity} onChange={set('quantity')} /></Field>
            {f.type === 'IN' && <Field label="Rate"><Input type="number" step="any" value={f.rate} onChange={set('rate')} /></Field>}
            <Field label="Date"><Input type="date" value={f.movementDate} onChange={set('movementDate')} /></Field>
            <Field label="Note"><Input value={f.note} onChange={set('note')} /></Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            {selected
              ? <p className="text-sm text-slate-500">Available: <span className="font-medium text-slate-700">{fmt(selected.currentQuantity)} {selected.unit}</span> @ ₹{fmt(selected.currentRate)}</p>
              : <span />}
            <Button variant="default" disabled={busy}>Record Movement</Button>
          </div>
        </form>
      </Card>

      {error && <Alert variant="error" role="alert" className="mt-4">{error}</Alert>}
      {result && (
        <div className="mt-4 grid gap-3">
          {result.warning && <Alert variant="warning" role="status">{result.warning}</Alert>}
          <Alert variant="success" role="status">
            Recorded {result.movement.type} of {fmt(result.movement.quantity)} {result.material.unit} for {result.material.materialId}
            {' '}(amount ₹{fmt(result.movement.amount)}). New balance: <b data-testid="balance">{fmt(result.movement.balanceAfter)}</b> {result.material.unit}.
          </Alert>
        </div>
      )}
    </>
  );
}
