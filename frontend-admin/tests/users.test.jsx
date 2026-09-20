// Admin Users page: deactivate / reactivate a user end to end against the real backend.
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

describe('Admin users: deactivate / reactivate', () => {
  it('deactivates and reactivates a user from the UI; badges follow; the server state matches; you cannot deactivate yourself', async () => {
    const adminLogin = await raw.post('/auth/login', { email: env.ADMIN1_EMAIL, password: env.ADMIN1_PASSWORD });
    const adminCookie = cookieOf(adminLogin);
    const email = `deact-ui-${Date.now().toString(36)}@test.com`;
    const su = await raw.post('/auth/signup', { name: 'Deactivate Me', email, password: 'Secret#123' });
    await raw.patch(`/users/${su.data.id}/approve`, undefined, { headers: { Cookie: adminCookie } });
    const serverActive = async () => (await raw.get('/users?limit=200', { headers: { Cookie: adminCookie } })).data.data.find((u) => u.email === email).active;

    await api.post('/auth/login', { email: env.ADMIN1_EMAIL, password: env.ADMIN1_PASSWORD }); // browser-side session (jsdom cookie jar)
    mount('/users');
    const row = async () => (await screen.findByText(email, { selector: 'td' })).closest('tr');
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    await screen.findByRole('button', { name: `Deactivate ${email}` });
    expect(within(await row()).getByText('Active')).toBeInTheDocument();

    // your own row: the button is disabled and says why
    const own = await screen.findByRole('button', { name: `Deactivate ${env.ADMIN1_EMAIL}` });
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
