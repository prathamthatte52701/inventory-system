import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg, fmt, parseNum, MAX_NUM } from '../api';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader, Pager } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const day = (d) => String(d).slice(0, 10);
const PAGE_SIZE = 200; // backend MAX_LIMIT; the UI pages through the rest

// editable = admin correction mode (the Movement Corrections page passes it)
export default function LedgerTable({ editable = false, title = 'Ledger' }) {
  const [materials, setMaterials] = useState([]);
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  const [error, setError] = useState('');
  const [run] = useGuard();
  const [edit, setEdit] = useState(null); // { id, type, quantity, rate, date, origDate, note }

  useEffect(() => { api.get('/materials').then((r) => setMaterials(r.data)).catch((e) => setError(errMsg(e))); }, []);
  const load = useCallback(() => {
    const seq = ++latest.current; // drop responses from superseded filter/page requests
    return api.get('/movements', { params: { page, limit: PAGE_SIZE, ...(filter ? { material: filter } : {}) } })
      .then((r) => {
        if (seq !== latest.current) return;
        const { data, total, totalPages } = r.data;
        if (!data.length && page > 1 && totalPages) return setPage(totalPages); // page vanished: step back
        setRows(data); setMeta({ total, totalPages }); setLoaded(true);
      })
      .catch((e) => { if (seq === latest.current) setError(errMsg(e)); });
  }, [filter, page]);
  useEffect(() => { load(); }, [load]);
  const pickFilter = (v) => { setFilter(v); setPage(1); };

  const startEdit = (m) => setEdit({
    id: m._id, type: m.type, quantity: String(m.quantity), rate: m.enteredRate == null ? '' : String(m.enteredRate),
    date: day(m.movementDate), origDate: day(m.movementDate), note: m.note || '',
  });
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  const save = () => run(async () => {
    setError('');
    const quantity = parseNum(edit.quantity, 0.0001);
    if (Number.isNaN(quantity)) return setError(`Quantity must be a number greater than 0 and at most ${fmt(MAX_NUM)}`);
    const body = { type: edit.type, quantity, note: edit.note };
    if (edit.type === 'IN') {
      const rate = parseNum(edit.rate, 0);
      if (Number.isNaN(rate)) return setError('Rate is required for IN');
      body.enteredRate = rate;
    }
    if (edit.date !== edit.origDate) {
      if (!edit.date) return setError('Please pick a date');
      body.movementDate = edit.date; // untouched date keeps its original time/order
    }
    try {
      await api.put(`/movements/${edit.id}`, body);
      setEdit(null);
      await load(); // recalculation touches later rows too, so reload the whole table
    } catch (err) {
      setError(errMsg(err));
    }
  });

  return (
    <>
      <PageHeader title={title} description={editable ? 'Correct a movement; every later balance and rate is recalculated automatically.' : 'Every stock movement, oldest first.'} />
      <div className="mb-4 max-w-sm">
        <Field label="Filter by material">
          <Select value={filter} onChange={(e) => pickFilter(e.target.value)}>
            <option value="">All materials</option>
            {materials.map((m) => <option key={m._id} value={m._id}>{m.materialId} — {m.description}</option>)}
          </Select>
        </Field>
      </div>
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}
      <TableWrap>
        <Table>
          <thead><tr>
            <Th>Date</Th><Th>Material ID</Th><Th>Type</Th><Th num>Qty</Th><Th num>Rate</Th>
            <Th num>Amount</Th><Th num>Balance</Th><Th>By</Th><Th>Note</Th>{editable && <Th>Actions</Th>}
          </tr></thead>
          <tbody>
            {rows.map((m) => {
              const editing = edit?.id === m._id;
              return (
                <Tr key={m._id} data-testid={`row-${m._id}`} className={editing ? 'bg-primary/5 even:bg-primary/5' : ''}>
                  <Td className="whitespace-nowrap">{editing ? <Input type="date" aria-label="Date" className="h-8 w-36" value={edit.date} onChange={set('date')} /> : day(m.movementDate)}</Td>
                  <Td className="font-medium">{m.material?.materialId}</Td>
                  <Td>{editing
                    ? <Select aria-label="Type" className="h-8 w-24" value={edit.type} onChange={set('type')}><option>IN</option><option>OUT</option><option>RETURN</option></Select>
                    : <span className="inline-flex items-center gap-1.5">{m.type}{m.isEdited && <span className="text-slate-400" title="edited"> ✎</span>}{m.exceededStock && <Badge tone="red" title="exceeded stock">exceeded</Badge>}</span>}</Td>
                  <Td num>{editing ? <Input type="number" step="any" aria-label="Quantity" className="h-8 w-20 text-right" value={edit.quantity} onChange={set('quantity')} /> : fmt(m.quantity)}</Td>
                  <Td num>{editing && edit.type === 'IN'
                    ? <Input type="number" step="any" aria-label="Rate" className="h-8 w-20 text-right" value={edit.rate} onChange={set('rate')} />
                    : `₹${fmt(m.rate)}`}</Td>
                  <Td num>₹{fmt(m.amount)}</Td>
                  <Td num>{fmt(m.balanceAfter)}</Td>
                  <Td>{m.createdBy?.name}</Td>
                  <Td className="text-slate-500">{editing ? <Input aria-label="Note" className="h-8 w-36" value={edit.note} onChange={set('note')} /> : m.note}</Td>
                  {editable && (
                    <Td>
                      <span className="flex gap-2">
                        {editing
                          ? <><Button variant="default" size="sm" onClick={save}>Save</Button><Button size="sm" onClick={() => setEdit(null)}>Cancel</Button></>
                          : <Button size="sm" onClick={() => startEdit(m)} aria-label={`Edit movement ${m._id}`}>Edit</Button>}
                      </span>
                    </Td>
                  )}
                </Tr>
              );
            })}
            {!rows.length && loaded && <EmptyRow cols={editable ? 10 : 9}>No movements yet.</EmptyRow>}
          </tbody>
        </Table>
      </TableWrap>
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} />
    </>
  );
}
