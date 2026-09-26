// Admin Analytics: StatGrid totals (per type, exact arithmetic), top-materials ranking + measure toggle,
// bucket (day/week) grouping, invalid-range guard, empty-range state, stale-response race, non-admin lockout.
// Real backend, real Mongo — no material/user scoping on analytics, so every window below is placed away from
// "today" and each test uses its own materials/date window so totals stay hand-computable and uncontaminated.
import { describe, it, expect, vi } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, session, renderApp, uid, makeUser } from './helpers';
import appApi, { fmt } from '../src/api';

const DAY = 864e5;
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysAgo = (n) => Date.now() - n * DAY;

async function openAnalytics() {
  renderApp('/analytics');
  await screen.findByRole('heading', { name: 'Analytics' });
}
const setDate = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function setRange(from, to) {
  setDate('From', from);
  setDate('To', to);
  await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(from));
}

describe('Admin analytics: volume totals (StatGrid)', () => {
  it('shows exact per-type count/amount for a hand-seeded window', async () => {
    // Window: 60/59 days ago, well clear of "today" and of every other window in this file.
    const D1 = dayStr(daysAgo(60)), D2 = dayStr(daysAgo(59));
    const api = as((await loginApi(ADMIN)).cookie);
    const matA = (await api.post('/materials', { materialId: uid('ANA'), description: 'Totals A', unit: 'Kg' })).data;
    const matB = (await api.post('/materials', { materialId: uid('ANB'), description: 'Totals B', unit: 'Kg' })).data;

    // Material A: IN 10@5 on D1, IN 20@8 on D2, OUT 6 (no rate) on D2.
    //   IN#1: stock was 0 -> rate = enteredRate = 5.  amount = 10*5 = 50
    //   IN#2: weighted avg = (10*5 + 20*8) / (10+20) = (50+160)/30 = 7.  amount = 20*8 = 160
    //   OUT:  mRate = current rate = 7.  amount = 6*7 = 42
    await api.post('/movements', { material: matA._id, type: 'IN', quantity: 10, rate: 5, movementDate: D1 });
    await api.post('/movements', { material: matA._id, type: 'IN', quantity: 20, rate: 8, movementDate: D2 });
    await api.post('/movements', { material: matA._id, type: 'OUT', quantity: 6, movementDate: D2 });
    // Material B: IN 15@10 on D1. stock was 0 -> rate = 10. amount = 15*10 = 150
    await api.post('/movements', { material: matB._id, type: 'IN', quantity: 15, rate: 10, movementDate: D1 });

    // Totals across A+B, per type:
    //   IN:  count = 3, quantity = 10+20+15 = 45, amount = 50+160+150 = 360
    //   OUT: count = 1, quantity = 6,            amount = 42
    //   RETURN: count = 0, quantity = 0, amount = 0
    await session(ADMIN);
    await openAnalytics();
    await setRange(D1, D2);

    const totals = await screen.findByTestId('volume-totals');
    await waitFor(() => expect(within(totals).getByTestId('total-IN')).toHaveTextContent('3'));
    expect(within(totals).getByTestId('total-IN').closest('div')).toHaveTextContent(`IN movements · ₹${fmt(360)}`);
    expect(within(totals).getByTestId('total-OUT')).toHaveTextContent('1');
    expect(within(totals).getByTestId('total-OUT').closest('div')).toHaveTextContent(`OUT movements · ₹${fmt(42)}`);
    expect(within(totals).getByTestId('total-RETURN')).toHaveTextContent('0');
    expect(within(totals).getByTestId('total-RETURN').closest('div')).toHaveTextContent(`RETURN movements · ₹${fmt(0)}`);
  }, 20000);
});

describe('Admin analytics: top materials + measure toggle', () => {
  it('ranks by value by default, and by quantity switches both the request param and the row order', async () => {
    // Dedicated window: 50 days ago, one day, two materials designed so value-rank and quantity-rank disagree.
    const D3 = dayStr(daysAgo(50));
    const api = as((await loginApi(ADMIN)).cookie);
    // Material C: small quantity, high rate -> high value.  IN 5@100 => quantity 5, amount 500.
    const matC = (await api.post('/materials', { materialId: uid('ANC'), description: 'Top C', unit: 'Kg' })).data;
    // Material D: large quantity, low rate -> low value.    IN 100@1 => quantity 100, amount 100.
    const matD = (await api.post('/materials', { materialId: uid('AND'), description: 'Top D', unit: 'Kg' })).data;
    await api.post('/movements', { material: matC._id, type: 'IN', quantity: 5, rate: 100, movementDate: D3 });
    await api.post('/movements', { material: matD._id, type: 'IN', quantity: 100, rate: 1, movementDate: D3 });
    // By value:    C (500) > D (100) -> C first
    // By quantity: D (100) > C (5)   -> D first  (ranking flips, proving the toggle really re-ranks)

    await session(ADMIN);
    await openAnalytics();
    await setRange(D3, D3);

    await screen.findByTestId(`top-${matC.materialId}`);
    let rows = screen.getAllByRole('row').filter((r) => r.querySelector('td'));
    expect(within(rows[0]).getByText(matC.materialId)).toBeInTheDocument();
    expect(within(rows[1]).getByText(matD.materialId)).toBeInTheDocument();
    expect(within(screen.getByTestId(`top-${matC.materialId}`)).getByText(`${fmt(5)} Kg`)).toBeInTheDocument();
    expect(within(screen.getByTestId(`top-${matD.materialId}`)).getByText(`${fmt(100)} Kg`)).toBeInTheDocument();

    const getSpy = vi.spyOn(appApi, 'get');
    await userEvent.selectOptions(screen.getByLabelText('Measure'), 'Quantity');
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/analytics/top-materials', expect.objectContaining({ params: expect.objectContaining({ by: 'quantity' }) })));

    await waitFor(() => {
      rows = screen.getAllByRole('row').filter((r) => r.querySelector('td'));
      expect(within(rows[0]).getByText(matD.materialId)).toBeInTheDocument();
    });
    expect(within(rows[1]).getByText(matC.materialId)).toBeInTheDocument();
    getSpy.mockRestore();
  }, 20000);
});

describe('Admin analytics: bucket grouping (day vs week)', () => {
  // DOM note: recharts renders real SVG <text> nodes in jsdom, but they proved unreliable to query deterministically
  // across repeated runs here, so this test verifies the real response shape the page receives instead (spying on
  // api.get without changing its behaviour) — a deliberate fallback, not a silent skip.
  it('day bucket keeps two distinct buckets; week bucket collapses them into one, keyed at that week\'s Monday', async () => {
    // A Monday/Wednesday pair inside the same ISO week, sitting ~40-46 days back (clear of the other windows).
    const base = new Date(daysAgo(40));
    const dow = base.getUTCDay(); // 0=Sun..6=Sat
    const monday = new Date(base.getTime() - ((dow + 6) % 7) * DAY);
    const wednesday = new Date(monday.getTime() + 2 * DAY);
    const MON = dayStr(monday), WED = dayStr(wednesday);

    const api = as((await loginApi(ADMIN)).cookie);
    const mat = (await api.post('/materials', { materialId: uid('ANE'), description: 'Bucket test', unit: 'Kg' })).data;
    await api.post('/movements', { material: mat._id, type: 'IN', quantity: 3, rate: 10, movementDate: MON });
    await api.post('/movements', { material: mat._id, type: 'IN', quantity: 4, rate: 10, movementDate: WED });

    await session(ADMIN);
    const getSpy = vi.spyOn(appApi, 'get');
    await openAnalytics();
    await setRange(MON, WED);

    await waitFor(() => expect(getSpy.mock.calls.some(([u, c]) => u === '/analytics/volume' && c.params.to === WED)).toBe(true));
    let idx = getSpy.mock.calls.findIndex(([u, c]) => u === '/analytics/volume' && c.params.to === WED && c.params.bucket === 'day');
    let res = await getSpy.mock.results[idx].value;
    expect(res.data.buckets.map((b) => b.bucket).sort()).toEqual([MON, WED]);

    getSpy.mockClear();
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'Week');
    await waitFor(() => expect(getSpy.mock.calls.some(([u, c]) => u === '/analytics/volume' && c.params.bucket === 'week')).toBe(true));
    idx = getSpy.mock.calls.findIndex(([u, c]) => u === '/analytics/volume' && c.params.bucket === 'week');
    res = await getSpy.mock.results[idx].value;
    expect(res.data.buckets.map((b) => b.bucket)).toEqual([MON]);

    getSpy.mockRestore();
  }, 20000);
});

describe('Admin analytics: invalid date range', () => {
  it('shows the exact warning and fires no request to either analytics endpoint', async () => {
    await session(ADMIN);
    await openAnalytics();
    await waitFor(() => screen.getByTestId('volume-totals')); // let the initial (valid, default range) fetch settle

    const getSpy = vi.spyOn(appApi, 'get');
    getSpy.mockClear();
    setDate('From', '2024-01-01'); // To still defaults to today, so this stays valid: this one fires
    await waitFor(() => expect(getSpy.mock.calls.some(([u]) => u === '/analytics/volume')).toBe(true));

    getSpy.mockClear();
    setDate('To', '2020-01-01'); // now From > To
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a valid date range (From must not be after To).');
    await new Promise((r) => setTimeout(r, 50));
    expect(getSpy.mock.calls.some(([u]) => u === '/analytics/volume')).toBe(false);
    expect(getSpy.mock.calls.some(([u]) => u === '/analytics/top-materials')).toBe(false);
    getSpy.mockRestore();
  });
});

describe('Admin analytics: empty range', () => {
  it('shows both empty states for a window with zero movements', async () => {
    await session(ADMIN);
    await openAnalytics();
    await setRange('2020-01-01', '2020-01-02'); // long before this suite existed

    expect(await screen.findByTestId('volume-empty')).toHaveTextContent('No movements in this date range.');
    const rows = screen.getAllByRole('row').filter((r) => r.querySelector('td'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('No movements in this date range.');
  });
});

describe('Admin analytics: race condition', () => {
  it('renders only the latest range\'s results when an earlier request resolves after a later one', async () => {
    await session(ADMIN);
    const realGet = appApi.get.bind(appApi);
    let volSeq = 0, topSeq = 0;
    const getSpy = vi.spyOn(appApi, 'get').mockImplementation((url, config) => {
      if (url === '/analytics/volume') {
        volSeq += 1; const seq = volSeq;
        const delay = seq === 2 ? 300 : 0; // 2nd request (first bucket change) is slow/stale
        const n = seq * 10;
        const data = { totals: { IN: { count: n, quantity: n, amount: n }, OUT: { count: 0, quantity: 0, amount: 0 }, RETURN: { count: 0, quantity: 0, amount: 0 } }, buckets: [] };
        return new Promise((resolve) => setTimeout(() => resolve({ data }), delay));
      }
      if (url === '/analytics/top-materials') {
        topSeq += 1; const seq = topSeq;
        const delay = seq === 2 ? 300 : 0;
        return new Promise((resolve) => setTimeout(() => resolve({ data: { data: [] } }), delay));
      }
      return realGet(url, config);
    });

    await openAnalytics(); // call #1 (mount): resolves immediately, total-IN -> 10
    await waitFor(() => expect(screen.getByTestId('total-IN')).toHaveTextContent('10'));

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'Week');  // call #2: slow, will be stale
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'Day');   // call #3: fast, supersedes #2

    await waitFor(() => expect(screen.getByTestId('total-IN')).toHaveTextContent('30'));

    // let call #2's delayed promise resolve and confirm it never overwrites the later result
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByTestId('total-IN')).toHaveTextContent('30');

    getSpy.mockRestore();
  });
});

describe('Admin analytics: non-admin access', () => {
  it('a non-admin cannot sign in to the admin app or ever reach Analytics', async () => {
    const u = await makeUser();
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), u.email);
    await userEvent.type(screen.getByLabelText('Password'), u.password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This app is for admins only');
    expect(screen.queryByRole('heading', { name: 'Analytics' })).toBeNull();
    expect(screen.queryByLabelText('Group by')).toBeNull();
  });
});
