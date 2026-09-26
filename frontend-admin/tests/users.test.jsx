// Admin Users page: deactivate / reactivate a user end to end against the real backend.
import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, session, renderApp, uid } from './helpers';

describe('Admin users: deactivate / reactivate', () => {
  it('deactivates and reactivates a user from the UI; badges follow; the server state matches; you cannot deactivate yourself', async () => {
    const adminApi = as((await loginApi(ADMIN)).cookie);
    const email = `${uid('deact').toLowerCase()}@test.com`;
    const su = await adminApi.post('/auth/signup', { name: 'Deactivate Me', email, password: 'Secret#123' });
    await adminApi.patch(`/users/${su.data.id}/approve`);
    const serverActive = async () => (await adminApi.get('/users?limit=200')).data.data.find((u) => u.email === email).active;

    await session(ADMIN); // browser-side session (jsdom cookie jar)
    renderApp('/users');
    const row = async () => (await screen.findByText(email, { selector: 'td' })).closest('tr');
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    await screen.findByRole('button', { name: `Deactivate ${email}` });
    expect(within(await row()).getByText('Active')).toBeInTheDocument();

    // your own row: the button is disabled and says why
    const own = await screen.findByRole('button', { name: `Deactivate ${ADMIN.email}` });
    expect(own).toBeDisabled();
    expect(own).toHaveAttribute('title', 'You cannot deactivate your own account');

    await userEvent.click(screen.getByRole('button', { name: `Deactivate ${email}` }));
    expect(await screen.findByRole('button', { name: `Reactivate ${email}` })).toBeInTheDocument();
    expect(within(await row()).getByText('Inactive')).toBeInTheDocument();
    expect(await serverActive()).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: `Reactivate ${email}` }));
    await waitFor(() => expect(screen.getByRole('button', { name: `Deactivate ${email}` })).toBeInTheDocument());
    expect(within(await row()).getByText('Active')).toBeInTheDocument();
    expect(await serverActive()).toBe(true);
  });
});

describe('Admin users: concurrent approve (atomicity + UI recovery)', () => {
  it('when another session approves first, the UI that loses shows the 409 and drops the stale pending row', async () => {
    const adminApi = as((await loginApi(ADMIN)).cookie); // the "other session", acting via a direct API call
    const email = `${uid('race').toLowerCase()}@test.com`;
    const su = await adminApi.post('/auth/signup', { name: 'Race Me', email, password: 'Secret#123' });

    await session(ADMIN); // this session drives the real AdminUsers UI
    renderApp('/users');
    const approveBtn = await screen.findByRole('button', { name: `Approve ${email}` });

    // the other session wins the race a moment before this session's own click lands
    await adminApi.patch(`/users/${su.data.id}/approve`);

    await userEvent.click(approveBtn);

    // the losing UI must surface the real 409, not fail silently or crash
    expect(await screen.findByRole('alert')).toHaveTextContent('User already processed');
    // and the pending row must be gone once load() re-syncs with the server (the user shows up as approved
    // in "All users" instead) — not left stuck in the pending table with a dead Approve button
    await waitFor(() => expect(screen.queryByRole('button', { name: `Approve ${email}` })).toBeNull());
    expect(await screen.findByRole('button', { name: `Deactivate ${email}` })).toBeInTheDocument();
  });
});
