// A user deactivated by an admin is kicked out on their next click, sees the generic login error, and is restored on reactivate.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { adminApi, makeUser, session, renderApp } from './helpers';

const type = async (label, text) => { const el = await screen.findByLabelText(label); await userEvent.clear(el); await userEvent.type(el, text); };

describe('user deactivation, seen from the user app', () => {
  it('live session ends on the next request; login shows the generic error; reactivation restores access', async () => {
    const u = await makeUser('Soon Gone');
    const admin = await adminApi();
    await session(u);
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    await admin.patch(`/users/${u.id}/deactivate`); // an admin deactivates them while they are signed in
    await userEvent.click(screen.getByRole('link', { name: 'Materials' })); // their very next request
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument(); // kicked out to login, no broken page
    expect(screen.queryByRole('navigation')).toBeNull();

    await type('Email', u.email); await type('Password', u.password); // even the CORRECT password
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password'); // generic: nothing says "deactivated"
    expect(alert.textContent).not.toMatch(/deactivat|inactive|disabled/i);

    await admin.patch(`/users/${u.id}/reactivate`);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument(); // restored
    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());
  });
});
