// Admin Ledger: corrections (reversal + corrected entry) end to end against the real backend.
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { describe, it, expect } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/AuthContext';
import App from '../src/App';
import api from '../src/api';

const BASE = 'http://127.0.0.1:5056/api';
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const raw = axios.create({ baseURL: BASE, adapter: 'http', validateStatus: () => true });
const cookieOf = (r) => 'token=' + /token=([^;]+)/.exec((r.headers['set-cookie'] || []).join(';'))[1];
const mount = (route) => render(<MemoryRouter initialEntries={[route]}><AuthProvider><App /></AuthProvider></MemoryRouter>);

async function setup() {
  const login = await raw.post('/auth/login', { email: env.ADMIN1_EMAIL, password: env.ADMIN1_PASSWORD });
  const headers = { Cookie: cookieOf(login) };
  const id = `COR${Date.now().toString(36)}`.toUpperCase();
  const mat = (await raw.post('/materials', { materialId: id, description: 'Correction test', unit: 'Bag' }, { headers })).data;
  const inn = (await raw.post('/movements', { material: mat._id, type: 'IN', quantity: 10, rate: 5 }, { headers })).data;
  await api.post('/auth/login', { email: env.ADMIN1_EMAIL, password: env.ADMIN1_PASSWORD }); // browser-side session
  const list = async () => (await raw.get('/movements', { params: { material: mat._id, limit: 50 }, headers })).data.data;
  const stock = async () => (await raw.get(`/materials/${mat._id}`, { headers })).data.currentQuantity;
  return { headers, mat, inn: inn.movement || inn, list, stock };
}
async function openLedger(mat) {
  mount('/ledger');
  const sel = await screen.findByLabelText('Filter by material');
  await waitFor(() => expect([...sel.options].some((o) => o.value === mat._id)).toBe(true));
  await userEvent.selectOptions(sel, mat._id);
}
const editBtn = (id) => screen.findByRole('button', { name: `Edit movement ${id}` });

describe('Admin ledger: corrections', () => {
  it('correct an IN: original kept + marked, reversal and correction rows added, edits locked, server matches', async () => {
    const { mat, inn, list, stock, headers } = await setup();
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
    const again = await raw.put(`/movements/${orig._id}`, { type: 'IN', quantity: 3, enteredRate: 5 }, { headers });
    expect(again.status).toBe(400);
  });

  it('a correction the backend rejects shows its message and adds no rows', async () => {
    const { mat, inn, list, stock, headers } = await setup();
    await raw.post('/movements', { material: mat._id, type: 'OUT', quantity: 10 }, { headers }); // stock now 0: reversing the IN would go below 0
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
