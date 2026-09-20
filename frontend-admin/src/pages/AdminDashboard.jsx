import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api';
import { Alert } from '@/components/ui/alert';
import { ActionBadge } from '@/components/ui/badge';
import { Loading, PageHeader, Section, StatCard, StatGrid } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const LINKS = [
  ['/materials', 'Materials', 'Add, edit, deactivate'],
  ['/ledger', 'Movement Corrections', 'Fix a ledger entry'],
  ['/users', 'Users', 'Approvals and roles'],
  ['/audit', 'Audit Log', 'Who did what'],
  ['/analytics', 'Analytics', 'Volume and top materials'],
];

export default function AdminDashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/users', { params: { status: 'pending', limit: 1 } }), api.get('/reports/dashboard'), api.get('/audit', { params: { limit: 5 } })])
      .then(([u, r, a]) => setD({ pending: u.data.total, low: r.data.lowStockCount, out: r.data.outOfStockCount, recent: a.data.data }))
      .catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <Alert variant="error" role="alert">{error}</Alert>;
  if (!d) return <Loading />;
  return (
    <>
      <PageHeader title="Admin Overview" description="What needs attention right now." />
      <StatGrid className="lg:grid-cols-3">
        <StatCard to="/users" aria-label="Pending signups" value={d.pending} label="Pending signups — review" testId="pending-count" tone={d.pending ? 'warning' : 'default'} />
        <StatCard value={d.low} label="Low stock" testId="low-count" tone={d.low ? 'warning' : 'default'} />
        <StatCard value={d.out} label="Out of stock" testId="out-count" tone={d.out ? 'danger' : 'default'} />
      </StatGrid>
      <Section title="Recent activity">
        <TableWrap>
          <Table>
            <thead><tr><Th>When</Th><Th>User</Th><Th>Action</Th><Th>Entity</Th></tr></thead>
            <tbody>
              {d.recent.map((a) => <Tr key={a._id}><Td className="whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</Td><Td>{a.userEmail}</Td><Td><ActionBadge action={a.action} /></Td><Td>{a.entityType}</Td></Tr>)}
              {!d.recent.length && <EmptyRow cols={4}>No activity yet.</EmptyRow>}
            </tbody>
          </Table>
        </TableWrap>
        <p className="mt-3 text-sm"><Link to="/audit" className="font-medium text-primary hover:underline">Full audit log →</Link></p>
      </Section>
      <Section title="Quick links">
        <StatGrid className="lg:grid-cols-3">
          {LINKS.map(([to, name, hint]) => (
            <Link key={to} to={to} className="flex flex-col gap-1 rounded-xl border border-line bg-elevated p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/10">
              <b className="text-[15px] font-semibold text-fg">{name}</b><span className="text-sm text-muted">{hint}</span>
            </Link>
          ))}
        </StatGrid>
      </Section>
    </>
  );
}
