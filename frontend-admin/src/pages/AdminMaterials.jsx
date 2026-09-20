import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import api, { errMsg, fmt, parseNum, MAX_NUM } from '../api';
import { useGuard } from '../useGuard';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

const EMPTY = { materialId: '', description: '', unit: '', openingRate: '0', openingQuantity: '0', minimumQuantity: '0' };

export default function AdminMaterials() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [run] = useGuard();
  const [form, setForm] = useState(null); // null = closed; { _id? , ...fields }

  const load = useCallback(() => api.get('/materials').then((r) => setItems(r.data)).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  const save = (e) => {
    e.preventDefault();
    return run(async () => {
      setError('');
      const { _id, materialId, ...rest } = form;
      if (!_id && !materialId.trim()) return setError('Material ID is required');
      if (!rest.description.trim() || !rest.unit.trim()) return setError('Description and unit are required');
      const nums = {};
      for (const k of ['openingRate', 'openingQuantity', 'minimumQuantity']) {
        nums[k] = parseNum(rest[k], 0);
        if (Number.isNaN(nums[k])) return setError(`${k} must be a number from 0 to ${fmt(MAX_NUM)}`);
      }
      try {
        const body = { ...rest, ...nums };
        if (_id) await api.put(`/materials/${_id}`, body);
        else await api.post('/materials', { materialId: materialId.trim(), ...body });
        setForm(null);
        await load();
      } catch (err) {
        setError(errMsg(err));
      }
    });
  };
  const toggle = (m) => run(async () => {
    setError('');
    try { await api.patch(`/materials/${m._id}/${m.isActive ? 'deactivate' : 'reactivate'}`); await load(); } catch (err) { setError(errMsg(err)); }
  });
  const edit = (m) => setForm({
    _id: m._id, materialId: m.materialId, description: m.description, unit: m.unit,
    openingRate: String(m.openingRate), openingQuantity: String(m.openingQuantity), minimumQuantity: String(m.minimumQuantity),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Manage Materials" description="Create, edit and deactivate materials. Nothing is ever hard-deleted.">
        {!form && <Button variant="default" onClick={() => setForm({ ...EMPTY })}><Plus className="h-4 w-4" aria-hidden="true" />Add Material</Button>}
      </PageHeader>
      {error && <Alert variant="error" role="alert" className="mb-4">{error}</Alert>}

      {form && (
        <Card className="mb-6">
          <form onSubmit={save} noValidate className="grid gap-5 p-5">
            <h2 className="text-base font-semibold">{form._id ? `Edit ${form.materialId}` : 'New material'}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Material ID"><Input value={form.materialId} onChange={set('materialId')} disabled={!!form._id} /></Field>
              <Field label="Description"><Input value={form.description} onChange={set('description')} /></Field>
              <Field label="Unit"><Input value={form.unit} onChange={set('unit')} /></Field>
              <Field label="Opening Rate"><Input type="number" step="any" value={form.openingRate} onChange={set('openingRate')} /></Field>
              <Field label="Opening Quantity"><Input type="number" step="any" value={form.openingQuantity} onChange={set('openingQuantity')} /></Field>
              <Field label="Minimum Quantity"><Input type="number" step="any" value={form.minimumQuantity} onChange={set('minimumQuantity')} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button type="button" onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="default">Save</Button>
            </div>
          </form>
        </Card>
      )}

      <TableWrap>
        <Table>
          <thead><tr>
            <Th>Material ID</Th><Th>Description</Th><Th>Unit</Th><Th num>Current Qty</Th><Th num>Rate</Th>
            <Th num>Min Qty</Th><Th>Status</Th><Th>Actions</Th>
          </tr></thead>
          <tbody>
            {items.map((m) => (
              <Tr key={m._id} className={m.isActive ? '' : 'text-muted/70'}>
                <Td className="font-medium">{m.materialId}{!m.isActive && ' (inactive)'}</Td><Td>{m.description}</Td><Td>{m.unit}</Td>
                <Td num>{fmt(m.currentQuantity)}</Td><Td num>₹{fmt(m.currentRate)}</Td>
                <Td num>{fmt(m.minimumQuantity)}</Td>
                <Td><StatusBadge status={m.status} /></Td>
                <Td>
                  <span className="flex gap-2">
                    <Button size="sm" onClick={() => edit(m)} aria-label={`Edit ${m.materialId}`}>Edit</Button>
                    <Button size="sm" variant={m.isActive ? 'danger' : 'secondary'} onClick={() => toggle(m)} aria-label={`${m.isActive ? 'Deactivate' : 'Reactivate'} ${m.materialId}`}>
                      {m.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </span>
                </Td>
              </Tr>
            ))}
            {!items.length && <EmptyRow cols={8}>No materials yet.</EmptyRow>}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}
