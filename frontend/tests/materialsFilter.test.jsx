// Materials list: client-side ID/description text filter + status filter.
import { describe, it, expect, beforeAll } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, adminApi, session, renderApp, uid } from './helpers';

const T = uid('FLT');
const A = `${T}ALPHA`, L = `${T}LOWB`, O = `${T}OUTC`;
const DESC = { [A]: `Zqwidget ${T}`, [L]: `Zqbolt ${T}`, [O]: `Zqnut ${T}` };

async function open() {
  await session(ADMIN);
  renderApp('/materials');
  await screen.findByText(A);
  const user = userEvent.setup();
  return { user, box: screen.getByLabelText('Search material'), sel: screen.getByLabelText('Status') };
}
const has = (id) => !!screen.queryByText(id, { exact: false });

describe('Materials filter', () => {
  beforeAll(async () => {
    const api = await adminApi();
    const mk = (id, openingQuantity, minimumQuantity) =>
      api.post('/materials', { materialId: id, description: DESC[id], unit: 'Nos', openingRate: 1, openingQuantity, minimumQuantity });
    await mk(A, 100, 10); await mk(L, 5, 10); await mk(O, 0, 10);
  });

  it('filters by ID substring, case-insensitively', async () => {
    const { user, box } = await open();
    await user.type(box, `${T}low`.toLowerCase());
    await waitFor(() => expect(has(A)).toBe(false));
    expect(has(L)).toBe(true); expect(has(O)).toBe(false);
  });

  it('filters by description substring, case-insensitively', async () => {
    const { user, box } = await open();
    await user.type(box, 'ZQNUT');
    await waitFor(() => expect(has(A)).toBe(false));
    expect(has(O)).toBe(true); expect(has(L)).toBe(false);
  });

  it.each([['AVAILABLE', A], ['LOW_STOCK', L], ['OUT_OF_STOCK', O]])('status %s isolates its material', async (st, id) => {
    const { user, box, sel } = await open();
    await user.type(box, T); // scope to this file's seeded rows
    await user.selectOptions(sel, st);
    await waitFor(() => expect([A, L, O].filter(has)).toEqual([id]));
  });

  it('text and status combine as AND', async () => {
    const { user, box, sel } = await open();
    await user.selectOptions(sel, 'LOW_STOCK');
    await user.type(box, 'zqwidget'); // matches ALPHA only, which is AVAILABLE
    expect(await screen.findByText(/No materials match your filter/)).toBeInTheDocument();
    await user.clear(box); await user.type(box, 'zqbolt');
    await waitFor(() => expect(has(L)).toBe(true));
    expect(has(A)).toBe(false);
  });

  it('no match shows the filter message, not "No materials yet."; clearing restores the list', async () => {
    const { user, box, sel } = await open();
    await user.type(box, 'definitely-not-a-material');
    expect(await screen.findByText(/No materials match your filter/)).toBeInTheDocument();
    expect(screen.queryByText('No materials yet.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(await screen.findByText(A)).toBeInTheDocument();
    expect(has(L) && has(O)).toBe(true);
    expect(box).toHaveValue(''); expect(sel).toHaveValue('');
  });
});
