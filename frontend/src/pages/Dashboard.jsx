import { useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Loading, PageHeader, StatCard, StatGrid } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/dashboard').then((r) => setD(r.data)).catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <Alert variant="error" role="alert">{error}</Alert>;
  if (!d) return <Loading />;

  return (
    <>
      <PageHeader title="Dashboard" description="Current stock across all active materials." />
      <StatGrid className="mb-6">
        <StatCard value={d.totalMaterials} label="Total Materials" testId="total-materials" />
        <StatCard value={`₹${fmt(d.totalStockValue)}`} label="Total Stock Value" testId="total-value" />
        <StatCard value={d.lowStockCount} label="Low Stock" testId="low-count" tone={d.lowStockCount ? 'warning' : 'default'} />
        <StatCard value={d.outOfStockCount} label="Out of Stock" testId="out-count" tone={d.outOfStockCount ? 'danger' : 'default'} />
      </StatGrid>
      <TableWrap>
        <Table>
          <thead><tr><Th>Material ID</Th><Th>Description</Th><Th num>Current Qty</Th><Th num>Rate</Th><Th num>Stock Value</Th><Th>Status</Th></tr></thead>
          <tbody>
            {d.materials.map((m) => (
              <Tr key={m._id}>
                <Td className="font-medium">{m.materialId}</Td><Td>{m.description}</Td>
                <Td num>{fmt(m.currentQuantity)} {m.unit}</Td>
                <Td num>₹{fmt(m.currentRate)}</Td>
                <Td num>₹{fmt(m.stockValue)}</Td>
                <Td><StatusBadge status={m.status} /></Td>
              </Tr>
            ))}
            {!d.materials.length && <EmptyRow cols={6}>No materials yet.</EmptyRow>}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}
