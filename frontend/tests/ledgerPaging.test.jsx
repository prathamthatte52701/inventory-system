// Ledger pagination: every movement past the backend's 200-row page cap must stay reachable.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, adminApi, session, renderApp, uid, backendRequire } from './helpers';

// The DB is remote, so 650 API posts take minutes: create the material via the API, bulk-insert its movements directly.
// movement #k (1-based, ledger order) is IN qty 1 @ 10 with balanceAfter k
async function seed(api, n, prefix) {
  const { data: m } = await api.post('/materials', { materialId: uid(prefix), description: prefix, unit: 'Bag' });
  const Movement = backendRequire('./models/Movement');
  const Material = backendRequire('./models/Material');
  const t0 = Date.UTC(2026, 0, 1);
  const docs = Array.from({ length: n }, (_, i) => ({
    material: m._id, type: 'IN', quantity: 1, rate: 10, enteredRate: 10, amount: 10, balanceAfter: i + 1, movementDate: new Date(t0 + i * 864e5),
  }));
  const moves = n ? await Movement.insertMany(docs) : [];
  await Material.updateOne({ _id: m._id }, { currentQuantity: n, currentRate: 10 });
  return { matId: m._id, moves };
}
const pick = async (matId) => {
  const sel = await screen.findByLabelText('Filter by material');
  await waitFor(() => expect([...sel.options].some((o) => o.value === matId)).toBe(true));
  await userEvent.selectOptions(sel, matId);
};
const row = (mv) => screen.findByTestId(`row-${mv._id}`);
const info = () => screen.getByTestId('page-info').textContent;
const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }));

describe('Ledger pagination', () => {
  let api, A, B, C, D;
  beforeAll(async () => {
    backendRequire('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env'), quiet: true });
    await backendRequire('./config/db.js')({ dbName: 'inventory_test_ui' }); // same throwaway DB the test server uses
    api = await adminApi();
    [A, B, C] = [await seed(api, 250, 'PA'), await seed(api, 201, 'PB'), await seed(api, 200, 'PC')];
    D = (await api.post('/materials', { materialId: uid('PD'), description: 'empty', unit: 'Bag' })).data._id;
  }, 300000);
  afterAll(async () => { // other suites assume the unfiltered ledger is small: remove the 650 seeded rows
    const ids = [A, B, C].map((x) => x.matId);
    await backendRequire('./models/Movement').deleteMany({ material: { $in: [...ids, D] } });
    await backendRequire('./models/Material').deleteMany({ _id: { $in: [...ids, D] } });
  }, 60000);
  beforeEach(() => session(ADMIN)); // afterEach logs the jsdom cookie jar out

  it('admin ledger: reaches #201, #225, #250 via Next; edit on page 2 reloads same page with fresh balances', async () => {
    renderApp('/admin/ledger'); // corrections live here; the public /ledger is view-only
    await pick(A.matId);
    await row(A.moves[0]);
    expect(info()).toBe('Page 1 of 2 (250 total)');
    expect(screen.queryByTestId(`row-${A.moves[200]._id}`)).toBeNull();
    await next();
    for (const k of [201, 225, 250]) expect(await row(A.moves[k - 1])).toBeInTheDocument();
    expect(info()).toBe('Page 2 of 2 (250 total)');
    expect(screen.queryByTestId(`row-${A.moves[0]._id}`)).toBeNull();

    // edit #201 qty 1 -> 5: balances after it grow by 4 (#250: 250 -> 254); stay on page 2
    const r = await row(A.moves[200]);
    await userEvent.click(r.querySelector('button[aria-label^="Edit movement"]'));
    const q = screen.getByLabelText('Quantity');
    await userEvent.clear(q); await userEvent.type(q, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect((screen.getByTestId(`row-${A.moves[249]._id}`)).textContent).toContain('254'));
    expect(info()).toBe('Page 2 of 2 (250 total)');
  }, 60000);

  it('public ledger pages through all 250 rows too and never shows edit controls, even to an admin', async () => {
    renderApp('/ledger');
    await pick(A.matId);
    await row(A.moves[0]);
    expect(info()).toBe('Page 1 of 2 (250 total)');
    await next();
    expect(await row(A.moves[249])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit movement/ })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  }, 60000);

  it('filter change resets to page 1 and re-paginates another material', async () => {
    renderApp('/ledger');
    await pick(A.matId); await row(A.moves[0]); await next(); await row(A.moves[249]);
    await pick(B.matId);
    await row(B.moves[0]);
    expect(info()).toBe('Page 1 of 2 (201 total)');
    expect(screen.queryByTestId(`row-${A.moves[249]._id}`)).toBeNull();
    await next();
    expect(await row(B.moves[200])).toBeInTheDocument(); // exactly 1 row on page 2
    expect(document.querySelectorAll('[data-testid^="row-"]')).toHaveLength(1);
  }, 60000);

  it('boundary: exactly 200 movements is a single page, no controls', async () => {
    renderApp('/ledger');
    await pick(C.matId);
    await row(C.moves[199]);
    expect(document.querySelectorAll('[data-testid^="row-"]')).toHaveLength(200);
    expect(screen.queryByTestId('page-info')).toBeNull();
  }, 60000);

  it('empty material: clean empty state, no page info', async () => {
    renderApp('/ledger');
    await pick(D);
    expect(await screen.findByText('No movements yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('page-info')).toBeNull();
  });

  it('rapid filter switching: final material wins, no leftover rows', async () => {
    renderApp('/ledger');
    const sel = await screen.findByLabelText('Filter by material');
    await waitFor(() => expect([...sel.options].some((o) => o.value === C.matId)).toBe(true));
    await userEvent.selectOptions(sel, A.matId);
    await userEvent.selectOptions(sel, B.matId);
    await userEvent.selectOptions(sel, D);
    await userEvent.selectOptions(sel, C.matId);
    await row(C.moves[0]);
    await new Promise((r) => setTimeout(r, 500)); // let any stale response land
    expect(document.querySelectorAll('[data-testid^="row-"]')).toHaveLength(200);
    expect(screen.queryByTestId(`row-${A.moves[0]._id}`)).toBeNull();
    expect(screen.queryByTestId(`row-${B.moves[0]._id}`)).toBeNull();
  }, 60000);

  it('regression: fetch sends page and consumes totalPages (no bare limit:200 truncation)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/components/LedgerTable.jsx'), 'utf8');
    expect(src).toMatch(/params:\s*\{[^}]*\bpage\b/);
    expect(src).toMatch(/totalPages/);
  });
});
