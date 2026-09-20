import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../api';
import { Alert } from '@/components/ui/alert';
import { ActionBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader, Pager } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const ENTITIES = ['Material', 'Movement', 'User'];
const ACTIONS = ['LOGIN', 'LOGOUT', 'SIGNUP', 'MATERIAL_CREATE', 'MATERIAL_UPDATE', 'MOVEMENT_CREATE', 'MOVEMENT_CORRECTION', 'MOVEMENT_EDIT', 'IMPORT_COMMIT', 'USER_APPROVE', 'USER_REJECT', 'USER_ROLE_CHANGE', 'USER_DEACTIVATE', 'USER_REACTIVATE'];
const PAGE_SIZE = 50;
const NONE = { entityType: '', action: '', from: '', to: '' };

export default function AdminAudit() {
  const [filters, setFilters] = useState(NONE);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const badRange = !!(filters.from && filters.to && filters.from > filters.to);

  const load = useCallback(() => {
    if (badRange) return undefined; // the API would reject it; the warning below tells the admin why
    const seq = ++latest.current; // drop responses from superseded filter/page requests
    const params = { page, limit: PAGE_SIZE, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
    return api.get('/audit', { params })
      .then((r) => {
        if (seq !== latest.current) return;
        const { data, total, totalPages } = r.data;
        if (!data.length && page > 1 && totalPages) return setPage(totalPages);
        setError(''); setRows(data); setMeta({ total, totalPages }); setLoaded(true);
      })
      .catch((e) => { if (seq === latest.current) setError(errMsg(e)); });
  }, [filters, page, badRange]);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title="Audit Log" description="Every recorded action, newest first." />
      <div className="mb-4 grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Entity type">
          <Select value={filters.entityType} onChange={set('entityType')}>
            <option value="">All</option>{ENTITIES.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Action">
          <Select value={filters.action} onChange={set('action')}>
            <option value="">All</option>{ACTIONS.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={filters.from} onChange={set('from')} /></Field>
        <Field label="To"><Input type="date" value={filters.to} onChange={set('to')} /></Field>
        <Button onClick={() => { setFilters(NONE); setPage(1); }}>Clear</Button>
      </div>
      {badRange && <Alert variant="warning" role="alert" className="mb-4">"From" is after "To".</Alert>}
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}
      <TableWrap>
        <Table>
          <thead><tr><Th>When</Th><Th>User</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <Tr key={a._id} data-testid={`audit-${a._id}`}>
                <Td className="whitespace-nowrap"><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time></Td><Td>{a.userEmail}</Td><Td><ActionBadge action={a.action} /></Td><Td>{a.entityType}</Td>
                <Td className="max-w-md truncate font-mono text-xs text-muted">{a.details && Object.keys(a.details).length ? JSON.stringify(a.details) : ''}</Td>
              </Tr>
            ))}
            {!rows.length && loaded && <EmptyRow cols={5}>No audit entries match.</EmptyRow>}
          </tbody>
        </Table>
      </TableWrap>
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} />
    </>
  );
}
