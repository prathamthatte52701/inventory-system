// Phase 8: ledger (admin edit + recalculation), user approvals, reports downloads, navbar / route guards.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, adminApi, makeUser, session, renderApp, uid, as, captureDownloads, blobBuffer, backendRequire } from './helpers';

const type = async (el, text) => { await userEvent.clear(el); await userEvent.type(el, text); };
const ExcelJS = backendRequire('exceljs');
const sheetOf = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb.worksheets[0]; };

// IN 100@400, IN 50@440, OUT 30 -> returns { id, matId, moves: [3 movements] }
async function seedLedger(api, prefix = 'LG') {
  const id = uid(prefix);
  const { data: m } = await api.post('/materials', { materialId: id, description: `Ledger ${id}`, unit: 'Bag' });
  const mv = async (body) => (await api.post('/movements', { material: m._id, ...body })).data.movement;
  const moves = [
    await mv({ type: 'IN', quantity: 100, rate: 400, movementDate: '2026-04-01' }),
    await mv({ type: 'IN', quantity: 50, rate: 440, movementDate: '2026-04-02' }),
    await mv({ type: 'OUT', quantity: 30, movementDate: '2026-04-03' }),
  ];
  return { id, matId: m._id, moves };
}
const pickMaterial = async (matId, label = 'Filter by material') => {
  const sel = await screen.findByLabelText(label);
  await waitFor(() => expect([...sel.options].some((o) => o.value === matId)).toBe(true));
  await userEvent.selectOptions(sel, matId);
};
const rowOf = (mv) => screen.getByTestId(`row-${mv._id}`);

describe('Phase 8 brutal', () => {
  it('ledger: renders all movements, filters by material', async () => {
    const api = await adminApi();
    const a = await seedLedger(api, 'LA');
    const b = await seedLedger(api, 'LB');
    await session(ADMIN);
    renderApp('/ledger');
    await screen.findByTestId(`row-${a.moves[0]._id}`);
    expect(screen.getByTestId(`row-${b.moves[2]._id}`)).toBeInTheDocument(); // unfiltered = everything

    await pickMaterial(a.matId);
    await waitFor(() => expect(screen.queryByTestId(`row-${b.moves[0]._id}`)).toBeNull());
    expect(screen.getAllByText(a.id)).toHaveLength(3);
    const r = within(rowOf(a.moves[2]));
    expect(r.getByText('OUT')).toBeInTheDocument();
    expect(r.getByText('₹12,400')).toBeInTheDocument(); // 30 x avg 413.33
  });

  it('admin ledger (/admin/ledger): admin edits FIRST movement qty 100->200; whole table recalculates', async () => {
    const api = await adminApi();
    const L = await seedLedger(api, 'ED');
    await session(ADMIN);
    renderApp('/admin/ledger');
    await pickMaterial(L.matId);
    await waitFor(() => expect(screen.queryAllByText(L.id)).toHaveLength(3));

    await userEvent.click(within(rowOf(L.moves[0])).getByRole('button', { name: /^Edit movement/ }));
    await type(within(rowOf(L.moves[0])).getByLabelText('Quantity'), '200');
    await userEvent.click(within(rowOf(L.moves[0])).getByRole('button', { name: 'Save' }));

    // row 1: qty 200, rate 400, amount 80,000, balance 200
    await waitFor(() => expect(within(rowOf(L.moves[0])).getByText('₹80,000')).toBeInTheDocument());
    const r1 = within(rowOf(L.moves[0]));
    expect(r1.getAllByText('200')).toHaveLength(2); // qty and balance
    expect(r1.getByTitle('edited')).toBeInTheDocument();
    // row 2 unchanged money, balance now 250; row 3 OUT at NEW avg 408, balance 220
    const r2 = within(rowOf(L.moves[1]));
    expect(r2.getByText('₹22,000')).toBeInTheDocument();
    expect(r2.getByText('250')).toBeInTheDocument();
    const r3 = within(rowOf(L.moves[2]));
    expect(r3.getByText('₹408')).toBeInTheDocument();
    expect(r3.getByText('₹12,240')).toBeInTheDocument();
    expect(r3.getByText('220')).toBeInTheDocument();

    const m = (await api.get(`/materials/${L.matId}`)).data;
    expect([m.currentQuantity, m.currentRate]).toEqual([220, 408]);
  });

  it('ledger: normal user sees the table but no edit controls', async () => {
    const api = await adminApi();
    const L = await seedLedger(api, 'NU');
    await session(await makeUser());
    renderApp('/ledger');
    await screen.findByTestId(`row-${L.moves[0]._id}`);
    expect(screen.queryByRole('button', { name: /^Edit movement/ })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('public ledger is view-only even for a logged-in admin (no Edit, no Actions column)', async () => {
    const api = await adminApi();
    const L = await seedLedger(api, 'PV');
    await session(ADMIN);
    renderApp('/ledger');
    await pickMaterial(L.matId);
    await waitFor(() => expect(screen.queryAllByText(L.id)).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /^Edit movement/ })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('admin users: approve + reject pending signups; role toggle; self toggle disabled', async () => {
    const api = await adminApi();
    const ok = { email: `${uid('a').toLowerCase()}@test.com`, name: 'To Approve' };
    const no = { email: `${uid('r').toLowerCase()}@test.com`, name: 'To Reject' };
    await as().post('/auth/signup', { ...ok, password: 'secret1' });
    await as().post('/auth/signup', { ...no, password: 'secret1' });
    const me = await session(ADMIN);
    renderApp('/admin/users');

    await userEvent.click(await screen.findByRole('button', { name: `Approve ${ok.email}` }));
    await waitFor(() => expect(screen.queryByRole('button', { name: `Approve ${ok.email}` })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: `Reject ${no.email}` }));
    await waitFor(() => expect(screen.queryByRole('button', { name: `Reject ${no.email}` })).toBeNull());

    const users = (await api.get('/users')).data;
    expect(users.find((u) => u.email === ok.email).status).toBe('approved');
    expect(users.find((u) => u.email === no.email).status).toBe('rejected');
    // approved user can now log in
    await as().post('/auth/login', { email: ok.email, password: 'secret1' });

    await userEvent.click(screen.getByRole('button', { name: `Make ${ok.email} admin` }));
    expect(await screen.findByRole('button', { name: `Make ${ok.email} user` })).toBeInTheDocument();
    expect((await api.get('/users')).data.find((u) => u.email === ok.email).role).toBe('admin');
    await userEvent.click(screen.getByRole('button', { name: `Make ${ok.email} user` }));
    expect(await screen.findByRole('button', { name: `Make ${ok.email} admin` })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: `Make ${ADMIN.email} user` })).toBeDisabled(); // self
    expect(me.user.email).toBe(ADMIN.email);
  });

  it('reports: 3 downloads produce valid non-empty files', async () => {
    const api = await adminApi();
    const L = await seedLedger(api, 'RP');
    await session(ADMIN);
    const files = captureDownloads();
    renderApp('/reports');

    await userEvent.click(await screen.findByRole('button', { name: 'Download Stock Value (Excel)' }));
    await waitFor(() => expect(files).toHaveLength(1));
    expect(files[0].name).toMatch(/^stock-value-.*\.xlsx$/);
    const xs = await blobBuffer(files[0].blob);
    expect(xs.length).toBeGreaterThan(500);
    expect(xs.slice(0, 2).toString()).toBe('PK');
    const ws = await sheetOf(xs);
    const row = ws.getRows(2, ws.rowCount - 1).find((r) => r.getCell(1).value === L.id);
    expect(row.values.slice(1)).toEqual([L.id, `Ledger ${L.id}`, 'Bag', 120, expect.closeTo(413.333333, 4), expect.closeTo(120 * 413.333333, 1), 'Available']);

    await userEvent.click(screen.getByRole('button', { name: 'Download Stock Value (PDF)' }));
    await waitFor(() => expect(files).toHaveLength(2));
    expect(files[1].name).toMatch(/\.pdf$/);
    const pdf = await blobBuffer(files[1].blob);
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);

    await pickMaterial(L.matId, 'Material');
    await userEvent.click(screen.getByRole('button', { name: 'Download Movement History (Excel)' }));
    await waitFor(() => expect(files).toHaveLength(3));
    expect(files[2].name).toMatch(/^movements-.*\.xlsx$/);
    const mws = await sheetOf(await blobBuffer(files[2].blob));
    expect(mws.rowCount).toBe(4); // header + 3 movements of that material
    expect(mws.getRow(2).getCell(2).value).toBe(L.id);
    expect(mws.getRow(4).getCell(4).value).toBe('OUT');
    expect(await screen.findByText(/Downloaded movements-/)).toBeInTheDocument();
  });

  it('navbar: admin sees every link + own name; logout returns to login', async () => {
    await session(ADMIN);
    renderApp('/');
    const nav = await screen.findByRole('navigation');
    for (const t of ['Dashboard', 'Materials', 'Stock Movement', 'Ledger', 'Reports', 'Admin']) expect(within(nav).getByRole('link', { name: t })).toBeInTheDocument();
    expect(within(nav).getByText(/Pratham Thatte/)).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
});

describe('Phase 8 break', () => {
  it('normal user: admin nav link hidden', async () => {
    const u = await makeUser('Normal Nancy');
    await session(u);
    renderApp('/');
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByText('Normal Nancy')).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Users' })).toBeNull();
    for (const t of ['Dashboard', 'Materials', 'Stock Movement', 'Ledger', 'Reports']) expect(within(nav).getByRole('link', { name: t })).toBeInTheDocument();
  });

  it('normal user hitting /admin/users by URL is redirected to the dashboard', async () => {
    await session(await makeUser());
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Users' })).toBeNull();
  });

  it('the old /users URL no longer reaches anything, even for an admin', async () => {
    await session(ADMIN);
    renderApp('/users');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Users' })).toBeNull();
  });

  it('logged-out user hitting /users is sent to login', async () => {
    renderApp('/users');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('admin ledger edit: invalid quantity blocked client-side; cancel leaves data alone', async () => {
    const api = await adminApi();
    const L = await seedLedger(api, 'BK');
    await session(ADMIN);
    renderApp('/admin/ledger');
    await pickMaterial(L.matId);
    await waitFor(() => expect(screen.queryAllByText(L.id)).toHaveLength(3));
    await userEvent.click(within(rowOf(L.moves[0])).getByRole('button', { name: /^Edit movement/ }));
    await type(within(rowOf(L.moves[0])).getByLabelText('Quantity'), '-5');
    await userEvent.click(within(rowOf(L.moves[0])).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/greater than 0/);
    await userEvent.click(within(rowOf(L.moves[0])).getByRole('button', { name: 'Cancel' }));
    expect((await api.get(`/materials/${L.matId}`)).data.currentQuantity).toBe(120);
  });

  it('admin ledger edit: saving without changes is clean (no edited flag, same numbers)', async () => {
    const api = await adminApi();
    const L = await seedLedger(api, 'NO');
    await session(ADMIN);
    renderApp('/admin/ledger');
    await pickMaterial(L.matId);
    await waitFor(() => expect(screen.queryAllByText(L.id)).toHaveLength(3));
    await userEvent.click(within(rowOf(L.moves[1])).getByRole('button', { name: /^Edit movement/ }));
    await userEvent.click(within(rowOf(L.moves[1])).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(rowOf(L.moves[1])).queryByRole('button', { name: 'Save' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(rowOf(L.moves[1])).queryByTitle('edited')).toBeNull();
    expect((await api.get(`/materials/${L.matId}`)).data.currentQuantity).toBe(120);
  });

  it('admin ledger edit: changing IN->OUT recalculates and shows exceeded badge when stock runs short', async () => {
    const api = await adminApi();
    const L = await seedLedger(api, 'TY');
    await session(ADMIN);
    renderApp('/admin/ledger');
    await pickMaterial(L.matId);
    await waitFor(() => expect(screen.queryAllByText(L.id)).toHaveLength(3));
    await userEvent.click(within(rowOf(L.moves[0])).getByRole('button', { name: /^Edit movement/ }));
    await userEvent.selectOptions(within(rowOf(L.moves[0])).getByLabelText('Type'), 'OUT');
    await userEvent.click(within(rowOf(L.moves[0])).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(rowOf(L.moves[0])).getByText('exceeded')).toBeInTheDocument());
    expect(within(rowOf(L.moves[0])).getByText('-100')).toBeInTheDocument();
  });

  it('reports: a rejected filter shows the API message instead of a broken file', async () => {
    await session(ADMIN);
    const files = captureDownloads();
    renderApp('/reports');
    await screen.findByRole('heading', { name: 'Reports' });
    const from = screen.getByLabelText('From'), to = screen.getByLabelText('To');
    await userEvent.type(from, '2026-05-01');
    await userEvent.type(to, '2026-04-01');
    await userEvent.click(screen.getByRole('button', { name: 'Download Movement History (Excel)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/"from" must not be after "to"/);
    expect(files).toHaveLength(0);
  });

  it('session revoked server-side: next API call clears the session (401 interceptor)', async () => {
    await session(ADMIN);
    renderApp('/');
    await screen.findByRole('navigation');
    await (await adminApi()).post('/auth/logout'); // logout bumps tokenVersion: the browser's cookie is now revoked
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Materials' }));
    expect(await screen.findByRole('heading', { name: 'Log in' }, { timeout: 8000 })).toBeInTheDocument();
  });
});
