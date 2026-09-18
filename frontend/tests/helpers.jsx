import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import { vi } from 'vitest';
import { AuthProvider } from '../src/AuthContext';
import App from '../src/App';

export const BASE = 'http://127.0.0.1:5055/api';
const backend = path.resolve(__dirname, '../../backend');
export const backendRequire = createRequire(path.join(backend, 'x.js'));

// credentials come from the real backend/.env (never hard-coded here)
const env = Object.fromEntries(
  fs.readFileSync(path.join(backend, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
export const ADMIN = { email: env.ADMIN1_EMAIL, password: env.ADMIN1_PASSWORD };

const raw = axios.create({ baseURL: BASE });
export const as = (token) => axios.create({ baseURL: BASE, headers: token ? { Authorization: `Bearer ${token}` } : {} });

let n = 0;
export const uid = (p = 'X') => `${p}${Date.now().toString(36)}${n++}`.toUpperCase();

export async function loginApi({ email, password }) {
  const { data } = await raw.post('/auth/login', { email, password });
  return data; // { token, user }
}
export const adminApi = async () => as((await loginApi(ADMIN)).token);

// creates + approves a normal user; returns { email, password, id }
export async function makeUser(name = 'Test User') {
  const email = `${uid('u').toLowerCase()}@test.com`;
  const password = 'secret1';
  const { data } = await raw.post('/auth/signup', { name, email, password });
  await (await adminApi()).patch(`/users/${data.id}/approve`);
  return { email, password, id: data.id, name };
}

// puts a real session into localStorage (what the app reads on load)
export async function session(creds) {
  const { token, user } = await loginApi(creds);
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  return { token, user };
}

export const renderApp = (route = '/') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>
  );

// capture downloads instead of navigating (jsdom has no blob URLs / navigation)
export function captureDownloads() {
  const files = [];
  let last;
  URL.createObjectURL = vi.fn((blob) => { last = blob; return 'blob:test'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { files.push({ name: this.download, blob: last }); });
  return files;
}
export const blobBuffer = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(Buffer.from(fr.result));
  fr.onerror = rej;
  fr.readAsArrayBuffer(blob);
});
