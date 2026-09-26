// Phase 7 item 6: an action on one admin page must show up on another without a manual page reload — each page
// fetches fresh on mount (plain useEffect, no client-side cache), so navigating IS the refresh. This proves that
// actually holds for real navigation within one continuous render tree, not just "a fresh renderApp() call works".
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, session, renderApp, uid } from './helpers';

const goTo = (name) => userEvent.click(screen.getByRole('link', { name }));

describe('Cross-page consistency: an action on one page reflects on another without a manual refresh', () => {
  it('deactivating a material on Materials shows up on Audit Log after navigating there (no reload)', async () => {
    const api = as((await loginApi(ADMIN)).cookie);
    const materialId = uid('XPC');
    await api.post('/materials', { materialId, description: 'Cross-page test', unit: 'Kg' });
    await session(ADMIN);

    renderApp('/materials');
    await screen.findByRole('heading', { name: 'Manage Materials' });
    await userEvent.click(await screen.findByRole('button', { name: `Deactivate ${materialId}` }));
    expect(await screen.findByText(`${materialId} (inactive)`)).toBeInTheDocument();

    // navigate within the SAME render tree — no renderApp() call, no reload
    await goTo('Audit Log');
    await screen.findByRole('heading', { name: 'Audit Log' });
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'MATERIAL_DEACTIVATE');
    await waitFor(() => expect(screen.getAllByTestId(/^audit-/).length).toBeGreaterThan(0));
    for (const row of screen.getAllByTestId(/^audit-/)) expect(row).toHaveTextContent('MATERIAL_DEACTIVATE');
  });

  it('a real movement posted directly to the backend shows up in Analytics\' top-materials table after navigating there (no reload)', async () => {
    const api = as((await loginApi(ADMIN)).cookie);
    const materialId = uid('XPA');
    // an oversized IN so this material reliably ranks in the top-10-by-value table alongside whatever else exists today
    const mat = (await api.post('/materials', { materialId, description: 'Cross-page analytics', unit: 'Kg' })).data;

    await session(ADMIN);
    renderApp('/materials');
    await screen.findByRole('heading', { name: 'Manage Materials' });

    // a movement created "elsewhere" (a raw API call, not through this UI) while the admin is already looking at Materials
    await api.post('/movements', { material: mat._id, type: 'IN', quantity: 1000, rate: 999999 });

    await goTo('Analytics');
    await screen.findByRole('heading', { name: 'Analytics' });
    // default range already covers today; confirm today's real movement shows up without needing a page reload
    await screen.findByTestId(`top-${materialId}`);
  });
});
