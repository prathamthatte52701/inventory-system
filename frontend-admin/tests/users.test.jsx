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
