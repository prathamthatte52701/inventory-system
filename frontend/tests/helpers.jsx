import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { vi } from 'vitest';
import { AuthProvider } from '../src/AuthContext';
import { ImportProvider } from '../src/ImportContext';
import App from '../src/App';

export const BASE = 'http://127.0.0.1:5055/api';
const backend = path.resolve(__dirname, '../../backend');
export const backendRequire = createRequire(path.join(backend, 'x.js'));

// credentials come from whichever env file globalSetup.js actually used (backend/.env.test if present, else
// backend/.env) — never hard-coded here, and never assumed to be .env: the server this test talks to was seeded
// from that same file, so reading the other one would silently break the moment the two diverge.
const envFile = fs.existsSync(path.join(backend, '.env.test')) ? '.env.test' : '.env';
const env = Object.fromEntries(
  fs.readFileSync(path.join(backend, envFile), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
export const JWT_SECRET = env.JWT_SECRET;
export const ADMIN = { email: env.ADMIN1_EMAIL, password: env.ADMIN1_PASSWORD };

const raw = axios.create({ baseURL: BASE, adapter: 'http' }) // node http: no CORS, Set-Cookie readable;
// the session is an httpOnly cookie now; `cookie` is the raw "token=..." pair from Set-Cookie
export const as = (cookie) => axios.create({ baseURL: BASE, adapter: 'http', headers: cookie ? { Cookie: cookie } : {} });

let n = 0;
export const uid = (p = 'X') => `${p}${Date.now().toString(36)}${n++}`.toUpperCase();

export async function loginApi({ email, password }) {
  const res = await raw.post('/auth/login', { email, password });
  return { user: res.data.user, cookie: res.headers['set-cookie'][0].split(';')[0], setCookie: res.headers['set-cookie'] };
}
export const adminApi = async () => as((await loginApi(ADMIN)).cookie);

// creates + approves a normal user; returns { email, password, id }
export async function makeUser(name = 'Test User') {
  const email = `${uid('u').toLowerCase()}@test.com`;
  const password = 'Secret#123';
  const { data } = await raw.post('/auth/signup', { name, email, password });
  await (await adminApi()).patch(`/users/${data.id}/approve`);
  return { email, password, id: data.id, name };
}

// logs in through the app's own axios instance so the httpOnly cookie lands in the jsdom cookie jar
export async function session(creds) {
  const { default: api } = await import('../src/api');
  const { data } = await api.post('/auth/login', creds);
  return { user: data.user };
}

// browser-history stand-ins so tests can press Back/Forward
function HistoryButtons() {
  const nav = useNavigate();
  return <div><button onClick={() => nav(-1)}>test-back</button><button onClick={() => nav(1)}>test-forward</button></div>;
}
export const renderApp = (route = '/', { entries, index } = {}) =>
  render(
    <MemoryRouter initialEntries={entries || [route]} initialIndex={index}>
      <AuthProvider><ImportProvider><App /><HistoryButtons /></ImportProvider></AuthProvider>
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
