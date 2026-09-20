// Read-only ledger renders reversal / correction rows (created via the admin API) without crashing and without Edit.
import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { adminApi, makeUser, session, renderApp, uid } from './helpers';

describe('Read-only ledger with corrections', () => {
  it('shows the marker, reversal and correction badges; no Edit buttons', async () => {
    const api = await adminApi();
    const { data: m } = await api.post('/materials', { materialId: uid('RC'), description: 'RC', unit: 'Bag' });
    const { data: mv } = await api.post('/movements', { material: m._id, type: 'IN', quantity: 10, rate: 5 });
    const id = (mv.movement || mv)._id;
    const put = await api.put(`/movements/${id}`, { type: 'IN', quantity: 20, enteredRate: 5 });
    expect(put.data.reversal.isReversal).toBe(true);
    await session(await makeUser());
    renderApp('/ledger');
    const sel = await screen.findByLabelText('Filter by material');
    await waitFor(() => expect([...sel.options].some((o) => o.value === m._id)).toBe(true));
    await userEvent.selectOptions(sel, m._id);
    const row = await screen.findByTestId(`row-${id}`);
    expect(within(row).getByTitle('corrected — see linked entries below')).toBeInTheDocument();
    expect(screen.getByTestId(`row-${put.data.reversal._id}`)).toHaveTextContent('reversal');
    expect(screen.getByTestId(`row-${put.data.corrected._id}`)).toHaveTextContent('correction');
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
  });
});
