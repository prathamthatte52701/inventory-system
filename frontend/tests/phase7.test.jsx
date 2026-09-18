// Phase 7: login, signup, dashboard, materials, movement entry — real backend, real HTTP.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, adminApi, makeUser, session, renderApp, uid, as } from './helpers';

const type = async (label, text) => { const el = await screen.findByLabelText(label); await userEvent.clear(el); await userEvent.type(el, text); };

describe('Phase 7 brutal', () => {
  it('login: admin logs in, cookie session, lands on dashboard', async () => {
    renderApp('/login');
    await type('Email', ADMIN.email);
    await type('Password', ADMIN.password);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0); // nothing stored where script can read it
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('signup: shows waiting-for-approval message', async () => {
    renderApp('/signup');
    await type('Name', 'New Person');
    await type('Email', `${uid('s').toLowerCase()}@test.com`);
    await type('Password', 'secret1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText(/waiting for admin approval/i)).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  it('dashboard + material list render real backend data', async () => {
    const api = await adminApi();
    const id = uid('DASH');
    const { data: m } = await api.post('/materials', { materialId: id, description: 'Dash Cement', unit: 'Bag', openingQuantity: 120, openingRate: 400, minimumQuantity: 50 });
    await session(ADMIN);

    const before = (await api.get('/reports/dashboard')).data;
    renderApp('/');
    const row = (await screen.findByText(id)).closest('tr');
    expect(within(row).getByText('Dash Cement')).toBeInTheDocument();
    expect(within(row).getByText(/120 Bag/)).toBeInTheDocument();
    expect(within(row).getByText('₹48,000')).toBeInTheDocument();
    expect(within(row).getByText('Available')).toBeInTheDocument();
    expect(screen.getByTestId('total-materials')).toHaveTextContent(String(before.totalMaterials));
    expect(screen.getByTestId('low-count')).toHaveTextContent(String(before.lowStockCount));
    expect(screen.getByTestId('out-count')).toHaveTextContent(String(before.outOfStockCount));
    expect(screen.getByTestId('total-value').textContent).toContain(Number(before.totalStockValue).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
    expect(m.status).toBe('AVAILABLE');
  });

  it('materials page: admin gets controls; can add, edit, deactivate via UI', async () => {
    await session(ADMIN);
    const id = uid('MAT');
    renderApp('/materials');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
    await type('Material ID', id.toLowerCase());
    await type('Description', 'UI Sand');
    await type('Unit', 'Kg');
    await type('Opening Rate', '10');
    await type('Opening Quantity', '5');
    await type('Minimum Quantity', '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const row = (await screen.findByText(id)).closest('tr'); // uppercased by backend
    expect(within(row).getByText('Low Stock')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: `Edit ${id}` }));
    await type('Description', 'UI Sand Fine');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('UI Sand Fine')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `Deactivate ${id}` }));
    expect(await screen.findByText(`${id} (inactive)`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `Reactivate ${id}` }));
    await waitFor(() => expect(screen.queryByText(`${id} (inactive)`)).not.toBeInTheDocument());
  });

  it('materials page: normal user sees a read-only list', async () => {
    const api = await adminApi();
    const id = uid('RO');
    await api.post('/materials', { materialId: id, description: 'Read Only Item', unit: 'Nos' });
    await session(await makeUser());
    renderApp('/materials');
    expect(await screen.findByText(id)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Material' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Deactivate / })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('movement entry: IN then OUT create movements and show updated balance', async () => {
    const api = await adminApi();
    const id = uid('MV');
    await api.post('/materials', { materialId: id, description: 'Move Me', unit: 'Bag' });
    await session(await makeUser());
    renderApp('/movement');
    const select = await screen.findByLabelText('Material');
    await screen.findByRole('option', { name: new RegExp(id) });

    await userEvent.selectOptions(select, screen.getByRole('option', { name: new RegExp(id) }));
    expect(screen.getByLabelText('Rate')).toBeInTheDocument(); // IN shows rate
    await type('Quantity', '100');
    await type('Rate', '400');
    await type('Note', 'first load');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('100'));
    expect(screen.queryByText(/⚠/)).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'OUT');
    expect(screen.queryByLabelText('Rate')).toBeNull(); // rate hidden for OUT
    await type('Quantity', '30');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('70'));

    const { data: { data: list } } = await api.get('/movements', { params: { material: (await api.get('/materials')).data.find((m) => m.materialId === id)._id } });
    expect(list.map((m) => [m.type, m.quantity, m.balanceAfter, m.amount])).toEqual([['IN', 100, 100, 40000], ['OUT', 30, 70, 12000]]);
  });
});

describe('Phase 7 break', () => {
  it('wrong password: shows error message, no crash, no session', async () => {
    renderApp('/login');
    await type('Email', ADMIN.email);
    await type('Password', 'definitely-wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i);
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  it('pending user login shows the API message', async () => {
    const email = `${uid('p').toLowerCase()}@test.com`;
    await as().post('/auth/signup', { name: 'Pend', email, password: 'secret1' });
    renderApp('/login');
    await type('Email', email);
    await type('Password', 'secret1');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/pending/i);
  });

  it('unauthenticated visit is redirected to /login', async () => {
    renderApp('/materials');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('movement form with no material selected is blocked client-side', async () => {
    const api = await adminApi();
    const before = (await api.get('/movements')).data.data.length;
    await session(await makeUser());
    renderApp('/movement');
    await screen.findByLabelText('Material');
    await type('Quantity', '5');
    await type('Rate', '10');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please select a material');
    expect((await api.get('/movements')).data.data.length).toBe(before); // nothing was sent
  });

  it('bad quantity / missing IN rate are blocked client-side', async () => {
    const api = await adminApi();
    const id = uid('BQ');
    await api.post('/materials', { materialId: id, description: 'Bad Qty', unit: 'Nos' });
    await session(await makeUser());
    renderApp('/movement');
    await screen.findByRole('option', { name: new RegExp(id) });
    await userEvent.selectOptions(screen.getByLabelText('Material'), screen.getByRole('option', { name: new RegExp(id) }));
    await type('Quantity', '0');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/greater than 0/);
    await type('Quantity', '-3');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/greater than 0/);
    await type('Quantity', '5');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/rate is required/i);
  });

  it('OUT exceeding stock still submits, shows API warning and negative balance', async () => {
    const api = await adminApi();
    const id = uid('EX');
    await api.post('/materials', { materialId: id, description: 'Exceed', unit: 'Bag', openingQuantity: 140, openingRate: 100 });
    await session(await makeUser());
    renderApp('/movement');
    await screen.findByRole('option', { name: new RegExp(id) });
    await userEvent.selectOptions(screen.getByLabelText('Material'), screen.getByRole('option', { name: new RegExp(id) }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'OUT');
    await type('Quantity', '500');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    const warn = await screen.findByText(/exceeds available stock/i);
    expect(warn).toHaveTextContent(new RegExp(id));
    expect(screen.getByTestId('balance')).toHaveTextContent('-360');
    expect(screen.queryByRole('alert')).toBeNull(); // not an error
  });

  it('API error on movement (inactive material) is shown, not thrown', async () => {
    const api = await adminApi();
    const id = uid('IN');
    const { data: m } = await api.post('/materials', { materialId: id, description: 'Soon inactive', unit: 'Nos' });
    await session(await makeUser());
    renderApp('/movement');
    await screen.findByRole('option', { name: new RegExp(id) });
    await userEvent.selectOptions(screen.getByLabelText('Material'), screen.getByRole('option', { name: new RegExp(id) }));
    await api.patch(`/materials/${m._id}/deactivate`); // deactivated behind the page's back
    await type('Quantity', '1');
    await type('Rate', '1');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found or inactive/i);
  });
});
