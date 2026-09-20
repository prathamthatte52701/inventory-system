import { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import api, { downloadFile, errMsg, localToday } from '../api';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page';

export default function Reports() {
  const [materials, setMaterials] = useState([]);
  const [f, setF] = useState({ material: '', from: '', to: '' });
  const [day, setDay] = useState(localToday);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [run, busy] = useGuard();

  useEffect(() => { api.get('/materials').then((r) => setMaterials(r.data)).catch(() => {}); }, []);

  const download = (path, params) => run(async () => {
    setMsg(null);
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
    }
  });
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));

  return (
    <>
      <PageHeader title="Reports" description="Download stock and movement data as Excel or PDF." />
      <div className="grid gap-5">
        <Card className="p-5">
          <CardTitle>Stock value</CardTitle>
          <p className="mb-4 mt-1 text-sm text-muted">Current quantity, rate and value of every active material.</p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => download('/reports/stock-value/excel')}><FileSpreadsheet className="h-4 w-4 text-ok" aria-hidden="true" />Download Stock Value (Excel)</Button>
            <Button disabled={busy} onClick={() => download('/reports/stock-value/pdf')}><FileText className="h-4 w-4 text-err" aria-hidden="true" />Download Stock Value (PDF)</Button>
          </div>
        </Card>
        <Card className="p-5">
          <CardTitle>Movement history</CardTitle>
          <p className="mb-4 mt-1 text-sm text-muted">Every IN, OUT and RETURN; narrow it by material and date range.</p>
          <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Material">
              <Select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })}>
                <option value="">All materials</option>
                {materials.map((m) => <option key={m._id} value={m._id}>{m.materialId} — {m.description}</option>)}
              </Select>
            </Field>
            <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
            <Button disabled={busy} onClick={() => download('/reports/movements/excel', params)}><FileSpreadsheet className="h-4 w-4 text-ok" aria-hidden="true" />Download Movement History (Excel)</Button>
          </div>
        </Card>
        <Card className="p-5">
          <CardTitle>Daily report</CardTitle>
          <p className="mb-4 mt-1 text-sm text-muted">Opening, receipts, issues and closing balance of every active material for one day (UTC).</p>
          <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            <Button disabled={busy || !day} onClick={() => download('/reports/daily-summary', { date: day })}><FileSpreadsheet className="h-4 w-4 text-ok" aria-hidden="true" />Download Daily Report</Button>
          </div>
        </Card>
        {msg && <Alert variant={msg.ok ? 'success' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</Alert>}
      </div>
    </>
  );
}
