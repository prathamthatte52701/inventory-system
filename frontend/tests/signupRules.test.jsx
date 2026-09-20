// Signup: live client-side rules mirror the server's, the strength meter and the password eye work, and a client
// bypass (raw HTTP) is rejected by the server with the very same message.
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import api from '../src/api';
import { passwordProblem, passwordStrength } from '../src/validation';
import { BASE, renderApp, uid } from './helpers';

const type = async (label, text) => { const el = await screen.findByLabelText(label); await userEvent.clear(el); if (text) await userEvent.type(el, text); };
const calls = (spy, url) => spy.mock.calls.filter((c) => c[0] === url).length;
const strength = () => screen.queryByTestId('password-strength')?.textContent;
const raw = axios.create({ baseURL: BASE, adapter: 'http', validateStatus: () => true });

const WEAK = [
  ['too short', 'Ab1!xyz', /8-32 characters/],
  ['too long', 'Aa1!' + 'x'.repeat(29), /8-32 characters/],
  ['no uppercase', 'secret#123', /uppercase letter/],
  ['no lowercase', 'SECRET#123', /lowercase letter/],
  ['no digit', 'Secret#abc', /digit/],
  ['no special character', 'Secret1234', /special character/],
];

describe('signup rules (client)', () => {
  it('each missing character class is rejected with its specific message, inline AND in the alert, and nothing is sent', async () => {
    const spy = vi.spyOn(api, 'post');
    renderApp('/signup');
    await type('Name', 'Valid Person');
    await type('Email', `${uid('w').toLowerCase()}@test.com`);
    for (const [label, pw, re] of WEAK) {
      await type('Password', pw);
      await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
      expect(await screen.findByRole('alert'), label).toHaveTextContent(re);
      expect(document.getElementById('signup-password-err'), label + ' inline').toHaveTextContent(re);
    }
    expect(calls(spy, '/auth/signup')).toBe(0);
  });

  it('errors appear instantly on blur (before any submit) and update while typing', async () => {
    renderApp('/signup');
    await type('Name', 'ab');
    await userEvent.tab();
    expect(document.getElementById('signup-name-err')).toHaveTextContent('Name must be 3-48 characters');
    await userEvent.type(screen.getByLabelText('Name'), 'c'); // now 3 characters: the message disappears live
    expect(document.getElementById('signup-name-err')).toBeNull();
    await type('Email', 'not-an-email');
    await userEvent.tab();
    expect(document.getElementById('signup-email-err')).toHaveTextContent('Enter a valid email address');
    await type('Email', 'ok@test.com');
    expect(document.getElementById('signup-email-err')).toBeNull();
    await type('Password', 'abc');
    await userEvent.tab();
    expect(document.getElementById('signup-password-err')).toHaveTextContent(/Password must/);
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('empty submit shows the required message; name 2 chars / 49 chars are rejected, 3 and 48 are fine', async () => {
    const spy = vi.spyOn(api, 'post');
    renderApp('/signup');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i);
    await type('Email', 'ok@test.com'); await type('Password', 'Secret#123');
    for (const bad of ['ab', 'x'.repeat(49)]) {
      await type('Name', bad);
      await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Name must be 3-48 characters');
    }
    expect(calls(spy, '/auth/signup')).toBe(0);
    expect(passwordProblem('Aa1!aaaa')).toBeNull(); // exactly 8
    expect(passwordProblem('Aa1!' + 'x'.repeat(28))).toBeNull(); // exactly 32
  });

  it('strength meter reacts to weak / medium / strong input', async () => {
    renderApp('/signup');
    await screen.findByLabelText('Password');
    expect(strength()).toBeUndefined(); // hidden until something is typed
    await type('Password', 'abc');
    expect(strength()).toMatch(/weak/i); expect(strength()).not.toMatch(/medium|strong/i);
    await type('Password', 'abcdefghijklmnop');
    expect(strength()).not.toMatch(/medium|strong/i); // long but fails the rules
    await type('Password', 'Abcdef1!');
    expect(strength()).toMatch(/medium/i);
    await type('Password', 'Abcdefgh1234!');
    expect(strength()).toMatch(/strong/i);
    await type('Password', 'abc');
    expect(strength()).toMatch(/weak/i); // and back down again
    // a password that violates any server rule is never "Strong", however long
    expect(passwordStrength('Abcdefgh1234').label).not.toBe('Strong'); // no special character
    expect(passwordStrength('abcdefghijklmnopqrstuvwxyz1234!').label).not.toBe('Strong'); // 31 chars but no uppercase
  });

  it('password eye toggle shows and hides the password, keeps the accessible name "Password"', async () => {
    renderApp('/signup');
    const input = await screen.findByLabelText('Password'); // the eye button is not part of the label
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.type(input, 'Secret#123');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Password')).toHaveValue('Secret#123');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('login page has the same eye toggle', async () => {
    renderApp('/login');
    const input = await screen.findByLabelText('Password');
    await userEvent.type(input, 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('a valid signup goes through', async () => {
    renderApp('/signup');
    await type('Name', 'Nova Tester'); await type('Email', `${uid('ok').toLowerCase()}@test.com`); await type('Password', 'Secret#123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText(/waiting for admin approval/i)).toBeInTheDocument();
  });
});

describe('signup rules (server, bypassing the client)', () => {
  it('every weak password is rejected by the API with the same message the client shows', async () => {
    for (const [label, pw] of WEAK) {
      const r = await raw.post('/auth/signup', { name: 'Direct Caller', email: `${uid('d').toLowerCase()}@test.com`, password: pw });
      expect(r.status, label).toBe(400);
      expect(r.data.errors.map((e) => e.message), label).toContain(passwordProblem(pw)); // client and server agree word for word
    }
  });
  it('bad name / email are rejected by the API too', async () => {
    const good = { name: 'Direct Caller', email: `${uid('e').toLowerCase()}@test.com`, password: 'Secret#123' };
    expect((await raw.post('/auth/signup', { ...good, name: 'ab' })).status).toBe(400);
    expect((await raw.post('/auth/signup', { ...good, name: 'x'.repeat(49) })).status).toBe(400);
    expect((await raw.post('/auth/signup', { ...good, email: 'nope' })).status).toBe(400);
  });
});
