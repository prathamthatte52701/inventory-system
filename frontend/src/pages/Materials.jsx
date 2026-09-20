import { useCallback, useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

export default function Materials() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => api.get('/materials').then((r) => { setItems(r.data); setLoaded(true); }).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const shown = items.filter((m) => (!status || m.status === status)
    && (!needle || `${m.materialId} ${m.description}`.toLowerCase().includes(needle)));
  const clear = () => { setQ(''); setStatus(''); };

  return (
    <>
      <PageHeader title="Material Master" description="Every material with its current stock and status." />
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}

      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <Field label="Search material">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Material ID or description" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="AVAILABLE">Available</option>
            <option value="LOW_STOCK">Low Stock</option>
            <option value="OUT_OF_STOCK">Out of Stock</option>
          </Select>
        </Field>
      </div>

      <TableWrap>
        <Table>
          <thead><tr>
            <Th>Material ID</Th><Th>Description</Th><Th>Unit</Th><Th num>Current Qty</Th><Th num>Rate</Th>
            <Th num>Min Qty</Th><Th>Status</Th>
          </tr></thead>
          <tbody>
            {shown.map((m) => (
              <Tr key={m._id} className={m.isActive ? '' : 'text-muted'}>
                <Td className="font-medium">{m.materialId}{!m.isActive && ' (inactive)'}</Td><Td>{m.description}</Td><Td>{m.unit}</Td>
                <Td num>{fmt(m.currentQuantity)}</Td><Td num>₹{fmt(m.currentRate)}</Td>
                <Td num>{fmt(m.minimumQuantity)}</Td>
                <Td><StatusBadge status={m.status} /></Td>
              </Tr>
            ))}
            {!items.length && loaded && <EmptyRow cols={7}>No materials yet.</EmptyRow>}
            {items.length > 0 && !shown.length && (
              <EmptyRow cols={7}>
                No materials match your filter.{' '}
                <button type="button" onClick={clear} className="text-primary underline">Clear filter</button>
              </EmptyRow>
            )}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}
