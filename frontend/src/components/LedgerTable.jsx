import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg, fmt } from '../api';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field, Select } from '@/components/ui/field';
import { PageHeader, Pager } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const day = (d) => String(d).slice(0, 10);
const PAGE_SIZE = 200; // backend MAX_LIMIT; the UI pages through the rest

// Read-only ledger for the normal user app. Corrections (editing a movement) live in the separate admin app.
export default function LedgerTable({ title = 'Ledger' }) {
  const [materials, setMaterials] = useState([]);
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  const [error, setError] = useState('');

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

  return (
    <>
      <PageHeader title={title} description="Every stock movement, oldest first." />
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
            <Th num>Amount</Th><Th num>Balance</Th><Th>By</Th><Th>Note</Th>
          </tr></thead>
          <tbody>
            {rows.map((m) => (
              <Tr key={m._id} data-testid={`row-${m._id}`}>
                <Td className="whitespace-nowrap">{day(m.movementDate)}</Td>
                <Td className="font-medium">{m.material?.materialId}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    {m.type}{m.isEdited && <span className="text-muted" title="edited"> ✎</span>}
                    {m.exceededStock && <Badge tone="red" title="exceeded stock">exceeded</Badge>}
                  </span>
                </Td>
                <Td num>{fmt(m.quantity)}</Td>
                <Td num>₹{fmt(m.rate)}</Td>
                <Td num>₹{fmt(m.amount)}</Td>
                <Td num>{fmt(m.balanceAfter)}</Td>
                <Td>{m.createdBy?.name}</Td>
                <Td className="text-muted">{m.note}</Td>
              </Tr>
            ))}
            {!rows.length && loaded && <EmptyRow cols={9}>No movements yet.</EmptyRow>}
          </tbody>
        </Table>
      </TableWrap>
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} />
    </>
  );
}
