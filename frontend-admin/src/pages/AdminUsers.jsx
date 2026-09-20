import { Fragment, useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../api';
import { useGuard } from '../useGuard';
import { useAuth } from '../AuthContext';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader, Pager, Section } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const PAGE_SIZE = 50;
const PENDING_LIMIT = 200; // backend max page size
const STATUS_TONE = { approved: 'green', pending: 'amber', rejected: 'red' };

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]); // the current page of ALL users
  const [pending, setPending] = useState([]); // pending signups, fetched separately so paging never hides one
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [error, setError] = useState('');
  const [run] = useGuard();
  const [open, setOpen] = useState(null); // { id, activity | null } for the expanded user

  // GET /users is paginated ({ data, page, limit, total, totalPages })
  const load = useCallback(() => Promise.all([
    api.get('/users', { params: { status: 'pending', limit: PENDING_LIMIT } }),
    api.get('/users', { params: { page, limit: PAGE_SIZE } }),
  ]).then(([p, u]) => {
    const { data, total, totalPages } = u.data;
    if (!data.length && page > 1 && totalPages) return setPage(totalPages); // page vanished: step back
    setPending(p.data.data); setUsers(data); setMeta({ total, totalPages });
  }).catch((e) => setError(errMsg(e))), [page]);
  useEffect(() => { load(); }, [load]);

  const act = (fn) => run(async () => {
    setError('');
    try { await fn(); await load(); } catch (e) { setError(errMsg(e)); }
  });
  const toggleDetails = async (u) => {
    if (open?.id === u._id) return setOpen(null);
    setOpen({ id: u._id, activity: null });
    try {
      const { data } = await api.get(`/users/${u._id}/activity`);
      setOpen((o) => (o?.id === u._id ? { id: u._id, activity: data } : o)); // ignore if another row was opened meanwhile
    } catch (e) { setError(errMsg(e)); setOpen(null); }
  };

  return (
    <>
      <PageHeader title="Users" description="Approve signups and manage who is an admin." />
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}

      <Section title="Pending signups" className="mt-0">
        <TableWrap>
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Requested</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {pending.map((u) => (
                <Tr key={u._id}>
                  <Td className="font-medium">{u.name}</Td><Td>{u.email}</Td><Td>{String(u.createdAt).slice(0, 10)}</Td>
                  <Td>
                    <span className="flex gap-2">
                      <Button size="sm" variant="default" onClick={() => act(() => api.patch(`/users/${u._id}/approve`))} aria-label={`Approve ${u.email}`}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => act(() => api.patch(`/users/${u._id}/reject`))} aria-label={`Reject ${u.email}`}>Reject</Button>
                    </span>
                  </Td>
                </Tr>
              ))}
              {!pending.length && <EmptyRow cols={4}>No pending signups.</EmptyRow>}
            </tbody>
          </Table>
        </TableWrap>
      </Section>

      <Section title="All users">
        <TableWrap>
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u._id === me.id;
                const next = u.role === 'admin' ? 'user' : 'admin';
                return (
                  <Fragment key={u._id}>
                    <Tr>
                      <Td className="font-medium">{u.name}</Td><Td>{u.email}</Td>
                      <Td><Badge tone={u.role === 'admin' ? 'primary' : 'slate'}>{u.role}</Badge></Td>
                      <Td><Badge tone={STATUS_TONE[u.status] || 'slate'} dot>{u.status}</Badge></Td>
                      <Td>
                        <span className="flex gap-2">
                          <Button size="sm" disabled={self} title={self ? 'You cannot change your own role' : ''}
                            onClick={() => act(() => api.patch(`/users/${u._id}/role`, { role: next }))} aria-label={`Make ${u.email} ${next}`}>
                            Make {next}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleDetails(u)} aria-expanded={open?.id === u._id} aria-label={`Details for ${u.email}`}>
                            {open?.id === u._id ? 'Hide' : 'Details'}
                          </Button>
                        </span>
                      </Td>
                    </Tr>
                    {open?.id === u._id && (
                      <tr data-testid={`activity-${u._id}`}><td colSpan="5" className="border-b border-line bg-primary/5 px-4 py-3 text-sm text-muted">
                        {open.activity
                          ? <>Movements created: <b>{open.activity.movementCount}</b>{open.activity.lastMovementAt && <> · last on {String(open.activity.lastMovementAt).slice(0, 10)}</>}</>
                          : 'Loading…'}
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
        <Pager page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} />
      </Section>
    </>
  );
}
