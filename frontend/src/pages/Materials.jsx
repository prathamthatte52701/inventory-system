import { useCallback, useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

export default function Materials() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('/materials').then((r) => setItems(r.data)).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Material Master" description="Every material with its current stock and status." />
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}

      <TableWrap>
        <Table>
          <thead><tr>
            <Th>Material ID</Th><Th>Description</Th><Th>Unit</Th><Th num>Current Qty</Th><Th num>Rate</Th>
            <Th num>Min Qty</Th><Th>Status</Th>
          </tr></thead>
          <tbody>
            {items.map((m) => (
              <Tr key={m._id} className={m.isActive ? '' : 'text-slate-400'}>
                <Td className="font-medium">{m.materialId}{!m.isActive && ' (inactive)'}</Td><Td>{m.description}</Td><Td>{m.unit}</Td>
                <Td num>{fmt(m.currentQuantity)}</Td><Td num>₹{fmt(m.currentRate)}</Td>
                <Td num>{fmt(m.minimumQuantity)}</Td>
                <Td><StatusBadge status={m.status} /></Td>
              </Tr>
            ))}
            {!items.length && <EmptyRow cols={7}>No materials yet.</EmptyRow>}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}
