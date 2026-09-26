import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg, fmt, parseNum } from '../api';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { PageHeader, Pager } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const day = (d) => String(d ?? '').slice(0, 10);
const NEEDS_RATE = 'IN requires a rate';
const TONE = { ok: 'green', 'new-material': 'blue', 'duplicate-skip': 'slate', rejected: 'red', 'sync-adjustment': 'amber', 'already-matches': 'slate' };
const LABEL = { ok: 'ok', 'new-material': 'new material', 'duplicate-skip': 'duplicate (skip)', rejected: 'rejected', 'sync-adjustment': 'adjust', 'already-matches': 'no change' };
const RES_TONE = { created: 'green', 'skipped-duplicate': 'slate', failed: 'red' };
const PAGE_SIZE = 20;

export default function Import() {
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null); // preview response; movements are edited in place
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [commitRun, committing] = useGuard();
  const [rateText, setRateText] = useState({});
  const fileRef = useRef(null);

  const [hist, setHist] = useState({ data: [], total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const loadHistory = useCallback(() =>
    api.get('/imports', { params: { page, limit: PAGE_SIZE } }).then((r) => setHist(r.data)).catch((e) => setError(errMsg(e))), [page]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const preview = async () => {
    if (!file) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await api.post('/imports/preview', fd);
      setPlan(data); setRateText({});
    } catch (e) { setPlan(null); setError(errMsg(e)); } finally { setBusy(false); }
  };

  // Client-side edit of a missing rate: valid rate >= 0 -> creatable, otherwise back to rejected.
  const setRate = (m, text) => {
    setRateText((t) => ({ ...t, [m.id]: text }));
    const n = parseNum(text);
    const ok = !Number.isNaN(n);
    setPlan((p) => ({
      ...p,
      movements: p.movements.map((x) => x.id !== m.id ? x : {
        ...x,
        rate: ok ? n : null,
        status: ok ? (x.newMaterial ? 'new-material' : 'ok') : 'rejected',
        reason: ok ? undefined : NEEDS_RATE,
      }),
    }));
  };
  // editable if rejected for a missing rate (or already edited: it keeps its input)
  const editable = (m) => m.type === 'IN' && (m.reason === NEEDS_RATE || m.id in rateText);

  const commit = () => commitRun(async () => {
    setError('');
    try {
      const { data } = await api.post('/imports/commit', { filename: plan.filename, materials: plan.materials, movements: plan.movements });
      setResult(data); setPlan(null); setFile(null); setRateText({});
      if (fileRef.current) fileRef.current.value = '';
      if (page !== 1) setPage(1); else loadHistory();
    } catch (e) { setError(errMsg(e)); }
  });

  const reset = () => { setResult(null); setPlan(null); setError(''); };
  const count = (s) => plan.movements.filter((m) => (s === 'create' ? m.status === 'ok' || m.status === 'new-material' || m.status === 'sync-adjustment' : m.status === s)).length;
  const create = plan ? count('create') : 0;
  const newMats = plan?.materials.filter((m) => m.unit === 'TBD') ?? [];
  const isSync = plan?.mode === 'sync';

  return (
    <>
      <PageHeader title="Import" description="Bring in a transaction file (Receipt/Issue) or a current-quantity snapshot from Excel or Word. Review the preview, then commit." />
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}

      {!result && (
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="File (.xlsx, .xls, .docx)">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.docx"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setPlan(null); }}
                className="text-sm text-fg file:mr-3 file:rounded-md file:border file:border-line file:bg-transparent file:px-3 file:py-1.5 file:text-fg" />
            </Field>
            <Button onClick={preview} disabled={!file || busy || committing}>{busy ? 'Reading file…' : 'Preview'}</Button>
          </div>
        </Card>
      )}

      {plan && (
        <section className="mb-8 grid gap-4" aria-label="Import preview">
          {plan.parseErrors?.length > 0 && (
            <Alert variant="warning">
              <p className="font-medium">Rows that could not be read (skipped)</p>
              <ul className="mt-1 list-disc pl-5">{plan.parseErrors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
            </Alert>
          )}
          {newMats.length > 0 && (
            <Alert variant="info">
              <p>{newMats.length} new materials will be created with unit "TBD" — set the real unit on the Materials page afterwards</p>
              <p className="mt-1 text-muted">{newMats.map((m) => `${m.edp} (${m.description})`).join(', ')}</p>
            </Alert>
          )}
          <p data-testid="import-summary" className="text-sm text-fg">
            {plan.summary.totalRows} rows read · {plan.summary.newMaterials} new materials · {create} will be created · {count('duplicate-skip')} already imported (skipped)
            {isSync && <> · {count('already-matches')} already match (no change)</>} · {count('rejected')} rejected — they will be skipped
          </p>
          <TableWrap>
            <Table>
              <thead><tr><Th>EDP</Th><Th>Description</Th><Th>Type</Th><Th num>Qty</Th><Th num>Rate</Th><Th>Date</Th><Th>Status</Th></tr></thead>
              <tbody>
                {plan.movements.length === 0 && <EmptyRow cols={7}>No movements found in this file.</EmptyRow>}
                {plan.movements.map((m) => (
                  <Tr key={m.id} data-testid="preview-row">
                    <Td>{m.edp}</Td><Td>{m.description}</Td><Td>{m.type ?? '—'}</Td>
                    <Td num>{m.status === 'sync-adjustment' ? `${m.delta > 0 ? '+' : ''}${fmt(m.delta)}` : fmt(m.quantity)}</Td>
                    <Td num>
                      {editable(m)
                        ? <Input type="number" min="0" step="any" aria-label={`Rate for ${m.id}`} className="w-28 text-right" value={rateText[m.id] ?? ''} onChange={(e) => setRate(m, e.target.value)} />
                        : m.rate == null ? '—' : fmt(m.rate)}
                    </Td>
                    <Td>{day(m.movementDate)}</Td>
                    <Td>
                      <Badge tone={TONE[m.status]} title={m.reason}>{LABEL[m.status] || m.status}</Badge>
                      {m.status === 'rejected' && m.reason && <div className="mt-1 text-xs text-muted">{m.reason}</div>}
                      {m.warning && <div className="mt-1 text-xs text-warn">{m.warning}</div>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="default" onClick={commit} disabled={create === 0 || committing}>{committing ? 'Committing…' : 'Commit Import'}</Button>
            <span className="text-sm text-muted">Rows that are still rejected or already imported will be skipped; everything else is committed.</span>
          </div>
        </section>
      )}

      {result && (
        <section className="mb-8 grid gap-4" aria-label="Import result">
          <Alert variant="success" role="status">
            Import finished: {result.summary.created} created, {result.summary.skipped} skipped, {result.summary.failed} failed
            ({result.summary.rowCount} rows, {result.summary.newMaterials} new materials).
          </Alert>
          {result.createdMaterials?.length > 0 && (
            <Alert variant="info">
              <p className="font-medium">New materials created</p>
              <ul className="mt-1 list-disc pl-5">{result.createdMaterials.map((m) => <li key={m.materialId}>{m.materialId} — {m.description} (unit {m.unit} — fix on Materials page)</li>)}</ul>
            </Alert>
          )}
          <TableWrap>
            <Table>
              <thead><tr><Th>Row</Th><Th>EDP</Th><Th>Type</Th><Th>Result</Th><Th>Reason</Th></tr></thead>
              <tbody>
                {result.results.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.row}</Td><Td>{r.edp}</Td><Td>{r.type}</Td>
                    <Td><Badge tone={RES_TONE[r.status]}>{r.status}</Badge></Td>
                    <Td>{r.status === 'failed' ? r.reason : ''}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <div className="flex items-center gap-3">
            <Link to="/materials" className="text-sm text-primary underline">Go to Materials</Link>
            <Button onClick={reset}>Import another file</Button>
          </div>
        </section>
      )}

      <h2 className="tech-label mb-3 text-sm text-muted">Import history</h2>
      <TableWrap>
        <Table>
          <thead><tr><Th>Date</Th><Th>Filename</Th><Th>By</Th><Th num>Rows</Th><Th num>Created</Th><Th num>Skipped</Th><Th num>Rejected</Th></tr></thead>
          <tbody>
            {hist.data.length === 0 && <EmptyRow cols={7}>No imports yet.</EmptyRow>}
            {hist.data.map((h) => (
              <Tr key={h._id}>
                <Td>{day(h.uploadedAt)}</Td><Td>{h.filename}</Td><Td>{h.uploadedBy?.name}</Td>
                <Td num>{h.rowCount}</Td><Td num>{h.createdCount}</Td><Td num>{h.skippedCount}</Td><Td num>{h.rejectedCount}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Pager page={hist.page ?? page} totalPages={hist.totalPages} total={hist.total} onPage={setPage} />
    </>
  );
}
