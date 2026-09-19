// /admin section: layout + navigation, dashboard, users activity, audit log (pagination), analytics, session expiry.
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/api';
import { ADMIN, adminApi, makeUser, session, renderApp, uid, as, backendRequire } from './helpers';

let Movement, Material, AuditLog;
const seeded = { materials: [], users: [] };
const pickDate = (label, v) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });

beforeAll(async () => {
  backendRequire('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env'), quiet: true });
  await backendRequire('./config/db.js')({ dbName: 'inventory_test_ui' }); // same throwaway DB the test server uses
  Movement = backendRequire('./models/Movement'); Material = backendRequire('./models/Material'); AuditLog = backendRequire('./models/AuditLog');
}, 60000);
beforeEach(() => session(ADMIN)); // the global afterEach logs the cookie jar out
afterAll(async () => { // audit rows are seeded in 2020 and analytics movements in 2019 so real data never collides
  await AuditLog.deleteMany({ createdAt: { $lt: new Date('2021-01-01') } });
  await Movement.deleteMany({ material: { $in: seeded.materials } });
  await Material.deleteMany({ _id: { $in: seeded.materials } });
}, 60000);

describe('admin shell + navigation', () => {
  it('main navbar has an Admin link (admin only) that opens /admin with its own nav and a way back', async () => {
    renderApp('/');
    const main = await screen.findByRole('navigation');
    await userEvent.click(within(main).getByRole('link', { name: 'Admin' }));
    expect(await screen.findByRole('heading', { name: 'Admin Overview' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
    for (const t of ['Overview', 'Materials', 'Movement Corrections', 'Users', 'Audit Log', 'Analytics', '← Back to app']) expect(within(nav).getByRole('link', { name: t })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Stock Movement' })).toBeNull(); // the main navbar is not rendered inside /admin
    await userEvent.click(within(nav).getByRole('link', { name: '← Back to app' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('every admin nav link lands on its page', async () => {
    renderApp('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Admin navigation' });
    for (const [link, heading] of [['Materials', 'Manage Materials'], ['Movement Corrections', 'Movement Corrections'], ['Users', 'Users'], ['Audit Log', 'Audit Log'], ['Analytics', 'Analytics'], ['Overview', 'Admin Overview']]) {
      await userEvent.click(within(nav).getByRole('link', { name: link }));
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });

  it('unknown /admin/* path falls back to the admin overview', async () => {
    renderApp('/admin/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Admin Overview' })).toBeInTheDocument();
  });

  it('logout from the admin console returns to login', async () => {
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('admin dashboard', () => {
  it('shows pending signups (linking to approvals), stock alerts and recent audit entries', async () => {
    await as().post('/auth/signup', { name: 'Pending Pat', email: `${uid('pp').toLowerCase()}@test.com`, password: 'secret1' });
    const a = await adminApi();
    const before = (await a.get('/users', { params: { status: 'pending' } })).data.length;
    const { data: m } = await a.post('/materials', { materialId: uid('LOWX'), description: 'Low one', unit: 'u', minimumQuantity: 100, openingQuantity: 1, openingRate: 1 });
    seeded.materials.push(m._id);
    const rep = (await a.get('/reports/dashboard')).data;
    renderApp('/admin');
    expect(await screen.findByTestId('pending-count')).toHaveTextContent(String(before));
    expect(Number(before)).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('low-count')).toHaveTextContent(String(rep.lowStockCount));
    expect(screen.getByTestId('out-count')).toHaveTextContent(String(rep.outOfStockCount));
    expect(screen.getAllByText('MATERIAL_CREATE').length).toBeGreaterThan(0); // recent activity
    await userEvent.click(screen.getByRole('link', { name: 'Pending signups' }));
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
  });

  it('recent activity is capped at 5 rows', async () => {
    renderApp('/admin');
    const h = await screen.findByRole('heading', { name: 'Recent activity' });
    const rows = within(h.closest('section')).getAllByRole('row').length - 1; // minus header
    expect(rows).toBe(5);
  });
});

describe('admin users: activity details', () => {
  it('Details shows how many movements that user created; toggles closed', async () => {
    const u = await makeUser('Busy Bee');
    const { data: m } = await (await adminApi()).post('/materials', { materialId: uid('ACT'), description: 'act', unit: 'u' });
    seeded.materials.push(m._id);
    await Movement.insertMany([1, 2, 3].map((n) => ({ material: m._id, type: 'IN', quantity: n, rate: 1, amount: n, balanceAfter: n, createdBy: u.id })));
    renderApp('/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: `Details for ${u.email}` }));
    const box = await screen.findByTestId(`activity-${u.id}`);
    await waitFor(() => expect(box).toHaveTextContent('Movements created: 3'));
    await userEvent.click(screen.getByRole('button', { name: `Details for ${u.email}` }));
    expect(screen.queryByTestId(`activity-${u.id}`)).toBeNull();
  });

  it('a user with no movements shows 0', async () => {
    const u = await makeUser('Idle Ida');
    renderApp('/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: `Details for ${u.email}` }));
    await waitFor(() => expect(screen.getByTestId(`activity-${u.id}`)).toHaveTextContent('Movements created: 0'));
  });
});

describe('admin audit log', () => {
  const day = (d, i = 0) => new Date(`${d}T12:00:${String(i % 60).padStart(2, '0')}Z`);
  const seed = (d, n, extra = {}) => AuditLog.insertMany(Array.from({ length: n }, (_, i) => ({ action: 'MOVEMENT_EDIT', entityType: 'Movement', userEmail: 'seed@x.com', createdAt: day(d, i), ...extra })));
  const rowsShown = () => document.querySelectorAll('[data-testid^="audit-"]').length;
  const filterDay = (d) => { pickDate('From', d); pickDate('To', d); };

  beforeAll(async () => {
    await seed('2020-01-01', 100); // exactly 2 pages of 50
    await seed('2020-02-01', 51);  // limit+1: page 2 has exactly one row
    await seed('2020-03-01', 50);  // exactly one page
    await seed('2020-04-01', 3, { action: 'USER_APPROVE', entityType: 'User' });
  }, 60000);

  it('reads real entries, newest first', async () => {
    renderApp('/admin/audit');
    await waitFor(() => expect(rowsShown()).toBeGreaterThan(0));
    const whens = [...document.querySelectorAll('[data-testid^="audit-"] time')].map((t) => new Date(t.getAttribute('datetime')).getTime());
    expect(whens.every((t, i) => i === 0 || whens[i - 1] >= t)).toBe(true);
    expect(rowsShown()).toBeLessThanOrEqual(50);
  });

  it('exactly 2 full pages: page info correct, Next reaches all 100 distinct rows, Next disabled at the end', async () => {
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    filterDay('2020-01-01');
    await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('Page 1 of 2 (100 total)'));
    const ids = new Set([...document.querySelectorAll('[data-testid^="audit-"]')].map((r) => r.dataset.testid));
    expect(ids.size).toBe(50);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('Page 2 of 2 (100 total)'));
    await waitFor(() => expect(document.querySelector(`[data-testid="${[...ids][0]}"]`)).toBeNull()); // page 1 rows replaced
    expect(rowsShown()).toBe(50);
    document.querySelectorAll('[data-testid^="audit-"]').forEach((r) => ids.add(r.dataset.testid));
    expect(ids.size).toBe(100);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Prev' }));
    await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('Page 1 of 2'));
  }, 60000);

  it('51 rows: page 2 has exactly 1 row', async () => {
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    filterDay('2020-02-01');
    await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('Page 1 of 2 (51 total)'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(rowsShown()).toBe(1));
    expect(screen.getByTestId('page-info')).toHaveTextContent('Page 2 of 2 (51 total)');
  }, 60000);

  it('50 rows: single page, no page controls', async () => {
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    filterDay('2020-03-01');
    await waitFor(() => expect(rowsShown()).toBe(50));
    expect(screen.queryByTestId('page-info')).toBeNull();
  }, 60000);

  it('changing a filter while on page 2 resets to page 1', async () => {
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    filterDay('2020-01-01');
    await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('Page 1 of 2'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('Page 2 of 2'));
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'MOVEMENT_EDIT');
    await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('Page 1 of 2 (100 total)'));
    await waitFor(() => expect(rowsShown()).toBe(50));
  }, 60000);

  it('entity + action filters and Clear; empty result shows a clean empty state', async () => {
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    filterDay('2020-04-01');
    await waitFor(() => expect(rowsShown()).toBe(3));
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'Material');
    expect(await screen.findByText('No audit entries match.')).toBeInTheDocument();
    expect(screen.queryByTestId('page-info')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'User');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'USER_APPROVE');
    await waitFor(() => expect(rowsShown()).toBe(3));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByLabelText('Action')).toHaveValue(''));
    await waitFor(() => expect(screen.queryByText('No audit entries match.')).toBeNull());
  }, 60000);

  it('the filters are sent to the API as query params (server-side, not client filtering)', async () => {
    const spy = vi.spyOn(api, 'get');
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'User');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'USER_REJECT');
    filterDay('2020-04-01');
    await waitFor(() => expect(spy.mock.calls.some(([u, c]) => u === '/audit' && c.params.entityType === 'User' && c.params.action === 'USER_REJECT' && c.params.from === '2020-04-01' && c.params.to === '2020-04-01' && c.params.page === 1)).toBe(true));
  });

  it('rapid filter changes: the last filter wins, no rows from earlier filters linger', async () => {
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    for (const d of ['2020-01-01', '2020-02-01', '2020-01-01', '2020-04-01', '2020-03-01']) filterDay(d);
    await waitFor(() => expect(rowsShown()).toBe(50));
    await new Promise((r) => setTimeout(r, 1500)); // let any stale response land
    expect(rowsShown()).toBe(50);
    expect(screen.queryByTestId('page-info')).toBeNull(); // 2020-03-01 has exactly 50 rows = 1 page (2020-01/02 would show controls)
    expect(document.querySelectorAll('td')[3]).toHaveTextContent('Movement');
  }, 60000);

  it('From after To: warning shown and no request is sent for it', async () => {
    const spy = vi.spyOn(api, 'get');
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    pickDate('From', '2020-05-02');
    await waitFor(() => expect(spy.mock.calls.filter(([u]) => u === '/audit').length).toBeGreaterThan(0));
    const n = spy.mock.calls.filter(([u]) => u === '/audit').length;
    pickDate('To', '2020-05-01');
    expect(await screen.findByRole('alert')).toHaveTextContent(/after/i);
    expect(spy.mock.calls.filter(([u]) => u === '/audit').length).toBe(n);
  });

  it('a normal user cannot read the audit API even with a valid session', async () => {
    const u = await makeUser();
    const { loginApi } = await import('./helpers');
    const { cookie } = await loginApi(u);
    await expect(as(cookie).get('/audit')).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe('admin analytics', () => {
  const D = (n) => `2019-05-${String(n).padStart(2, '0')}`;
  let A, B;
  beforeAll(async () => {
    const a = await adminApi();
    A = (await a.post('/materials', { materialId: uid('ANA'), description: 'Analytics A', unit: 'Bag' })).data;
    B = (await a.post('/materials', { materialId: uid('ANB'), description: 'Analytics B', unit: 'Kg' })).data;
    seeded.materials.push(A._id, B._id);
    const mv = (m, type, quantity, amount, date) => ({ material: m._id, type, quantity, rate: amount / quantity, amount, balanceAfter: 0, movementDate: new Date(date + 'T10:00:00Z') });
    await Movement.insertMany([mv(A, 'IN', 10, 100, D(3)), mv(A, 'IN', 5, 50, D(3)), mv(A, 'OUT', 4, 40, D(4)), mv(B, 'OUT', 100, 900, D(10)), mv(B, 'RETURN', 2, 20, D(17))]);
  }, 60000);
  const setRange = (from, to) => { pickDate('From', from); pickDate('To', to); };

  it('renders bucketed totals, the chart and the ranked top-materials table for the chosen range', async () => {
    renderApp('/admin/analytics');
    await screen.findByLabelText('From');
    setRange(D(1), D(30));
    await waitFor(() => expect(screen.getByTestId('total-IN')).toHaveTextContent('2'));
    expect(screen.getByTestId('total-OUT')).toHaveTextContent('2');
    expect(screen.getByTestId('total-RETURN')).toHaveTextContent('1');
    expect(screen.getByTestId('volume-chart')).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^top-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([`top-${B.materialId}`, `top-${A.materialId}`]); // by value: B 920 > A 190
    expect(within(rows[0]).getByText('₹920')).toBeInTheDocument();
    expect(within(rows[1]).getByText('₹190')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Measure'), 'quantity');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Top materials by quantity' })).toBeInTheDocument());
    expect(screen.getAllByTestId(/^top-/)[0].dataset.testid).toBe(`top-${B.materialId}`);
  }, 60000);

  it('changing the date range re-queries the backend with those params (no client-side filtering)', async () => {
    const spy = vi.spyOn(api, 'get');
    renderApp('/admin/analytics');
    await screen.findByLabelText('From');
    setRange(D(3), D(4));
    await waitFor(() => expect(screen.getByTestId('total-IN')).toHaveTextContent('2'));
    expect(screen.getByTestId('total-RETURN')).toHaveTextContent('0'); // D(17) is outside
    expect(spy.mock.calls.some(([u, c]) => u === '/analytics/volume' && c.params.from === D(3) && c.params.to === D(4))).toBe(true);
    expect(spy.mock.calls.some(([u, c]) => u === '/analytics/top-materials' && c.params.from === D(3) && c.params.to === D(4))).toBe(true);
    expect(screen.queryByTestId(`top-${B.materialId}`)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'week');
    await waitFor(() => expect(spy.mock.calls.some(([u, c]) => u === '/analytics/volume' && c.params.bucket === 'week')).toBe(true));
  }, 60000);

  it('empty range: clean empty states, zero totals, no crash', async () => {
    renderApp('/admin/analytics');
    await screen.findByLabelText('From');
    setRange('2001-01-01', '2001-01-31');
    expect(await screen.findByTestId('volume-empty')).toBeInTheDocument();
    for (const t of ['IN', 'OUT', 'RETURN']) expect(screen.getByTestId(`total-${t}`)).toHaveTextContent('0');
    expect(screen.queryByTestId('volume-chart')).toBeNull();
    expect(screen.getAllByText('No movements in this date range.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  }, 60000);

  it('From after To: warns instead of querying; a too-wide range shows the API message', async () => {
    const spy = vi.spyOn(api, 'get');
    renderApp('/admin/analytics');
    await screen.findByLabelText('From');
    await waitFor(() => expect(screen.getByTestId('volume-totals')).toBeInTheDocument());
    const n = spy.mock.calls.filter(([u]) => u === '/analytics/volume').length;
    pickDate('To', '2020-01-01'); pickDate('From', '2020-02-01'); // To first: the range is never valid in between
    expect(await screen.findByRole('alert')).toHaveTextContent(/from must not be after to/i);
    expect(spy.mock.calls.filter(([u]) => u === '/analytics/volume').length).toBe(n);
    setRange('1970-01-01', '2100-12-31');
    expect(await screen.findByText(/range must be at most/i)).toBeInTheDocument();
  }, 60000);
});

describe('admin session expiry', () => {
  it('session revoked mid-use: saving a material cleanly bounces to login (no stuck spinner, nothing created)', async () => {
    renderApp('/admin/materials');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
    const id = uid('EXP');
    await userEvent.type(screen.getByLabelText('Material ID'), id);
    await userEvent.type(screen.getByLabelText('Description'), 'Expired');
    await userEvent.type(screen.getByLabelText('Unit'), 'u');
    await (await adminApi()).post('/auth/logout'); // bumps tokenVersion: the browser cookie is now dead
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Log in' }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText('Admin Console')).toBeNull();
    const list = (await (await adminApi()).get('/materials')).data;
    expect(list.some((m) => m.materialId === id.toUpperCase())).toBe(false);
  }, 60000);

  it('session revoked mid-use on the audit page: next request bounces to login', async () => {
    renderApp('/admin/audit');
    await screen.findByLabelText('From');
    await (await adminApi()).post('/auth/logout');
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'User');
    expect(await screen.findByRole('heading', { name: 'Log in' }, { timeout: 8000 })).toBeInTheDocument();
  }, 60000);
});
