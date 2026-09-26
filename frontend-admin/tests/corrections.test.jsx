// Admin Ledger: corrections (reversal + corrected entry) end to end against the real backend.
import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, session, renderApp, uid } from './helpers';

async function setup() {
  const api = as((await loginApi(ADMIN)).cookie);
  const id = uid('COR');
  const mat = (await api.post('/materials', { materialId: id, description: 'Correction test', unit: 'Bag' })).data;
  const inn = (await api.post('/movements', { material: mat._id, type: 'IN', quantity: 10, rate: 5 })).data;
  await session(ADMIN); // browser-side session
  const list = async () => (await api.get('/movements', { params: { material: mat._id, limit: 50 } })).data.data;
  const stock = async () => (await api.get(`/materials/${mat._id}`)).data.currentQuantity;
  return { api, mat, inn: inn.movement || inn, list, stock };
}
async function openLedger(mat) {
  renderApp('/ledger');
  const sel = await screen.findByLabelText('Filter by material');
  await waitFor(() => expect([...sel.options].some((o) => o.value === mat._id)).toBe(true));
  await userEvent.selectOptions(sel, mat._id);
}
const editBtn = (id) => screen.findByRole('button', { name: `Edit movement ${id}` });

describe('Admin ledger: corrections', () => {
  it('correct an IN: original kept + marked, reversal and correction rows added, edits locked, server matches', async () => {
    const { mat, inn, list, stock, api } = await setup();
    await openLedger(mat);
    await userEvent.click(await editBtn(inn._id));
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getAllByText('reversal')).toHaveLength(1));
    expect(screen.getAllByText('correction')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();

    const rows = await list();
    expect(rows).toHaveLength(3);
    const orig = rows.find((m) => m._id === inn._id);
    const rev = rows.find((m) => m.isReversal);
    const cor = rows.find((m) => m.correctionOf && !m.isReversal);
    expect(orig.isEdited).toBe(true);
    expect(orig.quantity).toBe(10);
    expect(cor.quantity).toBe(20);
    expect(await stock()).toBe(20);

    const oRow = screen.getByTestId(`row-${orig._id}`);
    expect(within(oRow).getByTitle('corrected — see linked entries below')).toBeInTheDocument();
    expect(within(screen.getByTestId(`row-${rev._id}`)).getByText('reversal')).toBeInTheDocument();
    expect(within(screen.getByTestId(`row-${cor._id}`)).getByText('correction')).toBeInTheDocument();
    for (const [m, title] of [[orig, 'Already corrected'], [rev, 'Corrections cannot be corrected'], [cor, 'Corrections cannot be corrected']]) {
      const b = await editBtn(m._id);
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', title);
    }
    // the backend also refuses a second correction
    const again = await api.put(`/movements/${orig._id}`, { type: 'IN', quantity: 3, enteredRate: 5 }, { validateStatus: () => true });
    expect(again.status).toBe(400);
  });

  it('a correction the backend rejects shows its message and adds no rows', async () => {
    const { mat, inn, list, stock, api } = await setup();
    await api.post('/movements', { material: mat._id, type: 'OUT', quantity: 10 }); // stock now 0: reversing the IN would go below 0
    await openLedger(mat);
    await userEvent.click(await editBtn(inn._id));
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent.length).toBeGreaterThan(0);
    expect(screen.queryByText('reversal')).toBeNull();
    expect(screen.queryByText('correction')).toBeNull();
    expect(await list()).toHaveLength(2);
    expect(await stock()).toBe(0);
    expect((await list()).some((m) => m.isEdited)).toBe(false);
  });
});
