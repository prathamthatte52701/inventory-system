// Admin Ledger: corrections (reversal + corrected entry) end to end against the real backend.
import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, session, renderApp, uid, makeUser } from './helpers';
import appApi from '../src/api'; // the app's own axios instance (for spying on client-side validation)

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
// like setup(), but doesn't create the default IN — for tests that need their own dated movements
async function bareSetup() {
  const api = as((await loginApi(ADMIN)).cookie);
  const id = uid('COR');
  const mat = (await api.post('/materials', { materialId: id, description: 'Correction test', unit: 'Bag' })).data;
  await session(ADMIN);
  const list = async () => (await api.get('/movements', { params: { material: mat._id, limit: 50 } })).data.data;
  const stock = async () => (await api.get(`/materials/${mat._id}`)).data.currentQuantity;
  return { api, mat, list, stock };
}
const dOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

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

  it('the backend also rejects correcting the reversal or the corrected entry directly, not just the original again', async () => {
    const { mat, inn, list, stock, api } = await setup();
    await openLedger(mat);
    await userEvent.click(await editBtn(inn._id));
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByText('reversal')).toHaveLength(1));

    const rows = await list();
    const rev = rows.find((m) => m.isReversal);
    const cor = rows.find((m) => m.correctionOf && !m.isReversal);
    const before = await list();

    const [rOriginal, rReversal, rCorrected] = await Promise.all([
      api.put(`/movements/${inn._id}`, { quantity: 1 }, { validateStatus: () => true }),
      api.put(`/movements/${rev._id}`, { quantity: 1 }, { validateStatus: () => true }),
      api.put(`/movements/${cor._id}`, { quantity: 1 }, { validateStatus: () => true }),
    ]);
    expect(rOriginal.status).toBe(400);
    expect(rReversal.status).toBe(400);
    expect(rCorrected.status).toBe(400);
    expect(rReversal.data.message).toMatch(/correct/i);
    expect(rCorrected.data.message).toMatch(/correct/i);

    expect(await list()).toEqual(before);
    expect(await stock()).toBe(20);
  });

  it('correcting an OUT through the UI posts an IN reversal and an OUT corrected entry; stock matches', async () => {
    const { mat, list, stock, api } = await setup(); // setup()'s IN of 10 is the supply the OUT draws from
    const out = (await api.post('/movements', { material: mat._id, type: 'OUT', quantity: 6 })).data.movement;
    await openLedger(mat);
    await userEvent.click(await editBtn(out._id));
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByText('reversal')).toHaveLength(1));
    expect(screen.getAllByText('correction')).toHaveLength(1);

    const rows = await list();
    expect(rows).toHaveLength(4);
    const rev = rows.find((m) => m.isReversal);
    const cor = rows.find((m) => m.correctionOf && !m.isReversal);
    expect(rev.type).toBe('IN'); expect(rev.quantity).toBe(6);
    expect(cor.type).toBe('OUT'); expect(cor.quantity).toBe(4);
    expect(await stock()).toBe(6); // 10 - 6 + 6 - 4
  });

  it('correcting an early IN down with an explicit back-date: the reversal itself is what rejects it (not a phantom future negative)', async () => {
    // IN 10 early, OUT 9 later leaves only 1 in stock "now" — the reversal (an OUT of the original's 10) can never
    // clear that check, so the correction is refused before the back-dated corrected entry is ever considered.
    const { api, mat, list, stock } = await bareSetup();
    const inDate = dOffset(-10), outDate = dOffset(-5), correctedDate = dOffset(-11);
    const inn = (await api.post('/movements', { material: mat._id, type: 'IN', quantity: 10, rate: 5, movementDate: inDate })).data.movement;
    await api.post('/movements', { material: mat._id, type: 'OUT', quantity: 9, movementDate: outDate });

    await openLedger(mat);
    await userEvent.click(await editBtn(inn._id));
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '3');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: correctedDate } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent.length).toBeGreaterThan(0);

    // reproduce the identical PUT directly: the correction was fully rolled back, so this deterministically repeats
    // the same failure — confirming the UI's alert is the backend's real message, not a guess
    const direct = await api.put(`/movements/${inn._id}`, { type: 'IN', quantity: 3, enteredRate: 5, movementDate: correctedDate }, { validateStatus: () => true });
    expect(direct.status).toBe(400);
    expect(alert.textContent).toBe(direct.data.message);

    const rows = await list();
    expect(rows).toHaveLength(2);
    expect(rows.some((m) => m.isEdited || m.isReversal || m.correctionOf)).toBe(false);
    expect(await stock()).toBe(1);
  });

  it('a corrected entry that itself becomes a back-dated OUT and would starve a later OUT is rejected, nothing left behind', async () => {
    // Mirrors the backend's own spec for this exact message (backend/tests/corrections.test.js, case C9):
    // IN 10 (early), OUT 9 (mid), IN 20 (late) — the reversal (OUT 10, dated now) is fine since current stock is 21,
    // but changing the corrected entry to an OUT of 5 back-dated between the IN and the OUT starves that later OUT.
    const { api, mat, list, stock } = await bareSetup();
    const d1 = dOffset(-20), d2 = dOffset(-18), d3 = dOffset(-16), between = dOffset(-19);
    const inn = (await api.post('/movements', { material: mat._id, type: 'IN', quantity: 10, rate: 5, movementDate: d1 })).data.movement;
    await api.post('/movements', { material: mat._id, type: 'OUT', quantity: 9, movementDate: d2 });
    await api.post('/movements', { material: mat._id, type: 'IN', quantity: 20, rate: 5, movementDate: d3 });

    await openLedger(mat);
    await userEvent.click(await editBtn(inn._id));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'OUT');
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '5');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: between } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/back-dated OUT/);
    expect(alert.textContent).toMatch(new RegExp(`negative on ${d2}`));

    const rows = await list();
    expect(rows).toHaveLength(3);
    expect(rows.some((m) => m.isEdited || m.isReversal || m.correctionOf)).toBe(false);
    expect(await stock()).toBe(21);
  });

  it('two concurrent corrections of the same original: exactly one wins, the material ends where the winner says', async () => {
    const { mat, inn, list, stock, api } = await setup();
    const [r1, r2] = await Promise.all([
      api.put(`/movements/${inn._id}`, { quantity: 15 }, { validateStatus: () => true }),
      api.put(`/movements/${inn._id}`, { quantity: 25 }, { validateStatus: () => true }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    const winner = r1.status === 200 ? r1 : r2;

    const rows = await list();
    expect(rows).toHaveLength(3); // not 5: the loser posted nothing
    expect(await stock()).toBe(winner.data.material.currentQuantity);
  });

  it('an invalid correction (negative quantity, non-numeric rate) is blocked client-side with no request sent, and the backend independently rejects it too', async () => {
    const { mat, inn, api } = await setup();
    await openLedger(mat);
    await userEvent.click(await editBtn(inn._id));
    const putSpy = vi.spyOn(appApi, 'put'); // the app's own axios instance (imported at top of this file)
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '-5');
    const rate = screen.getByLabelText('Rate');
    await userEvent.clear(rate); await userEvent.type(rate, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();

    // bypass the client: PUT the same invalid body directly via the raw test api and confirm the backend independently rejects it
    const direct = await api.put(`/movements/${inn._id}`, { quantity: -5, enteredRate: 'abc' }, { validateStatus: () => true });
    expect(direct.status).toBe(400);
  });
});

describe('Admin ledger: access control', () => {
  it('a non-admin cannot sign in to the admin app or reach the ledger', async () => {
    const u = await makeUser();
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), u.email);
    await userEvent.type(screen.getByLabelText('Password'), u.password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This app is for admins only');
    expect(screen.queryByLabelText('Filter by material')).toBeNull();
  });
});
