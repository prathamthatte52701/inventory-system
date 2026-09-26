import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthProvider } from '../src/AuthContext';
import App from '../src/App';

export const BASE = 'http://127.0.0.1:5056/api';
const backend = path.resolve(__dirname, '../../backend');

// Same file globalSetup.js's testEnvGuard actually loaded (backend/.env.test if it exists, else backend/.env) —
// reading credentials from the real .env unconditionally here would silently break the moment .env.test's admin
// accounts differ from .env's, since the server this test talks to was seeded from whichever file the guard chose.
const envFile = fs.existsSync(path.join(backend, '.env.test')) ? '.env.test' : '.env';
const env = Object.fromEntries(
  fs.readFileSync(path.join(backend, envFile), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
export const ADMIN = { email: env.ADMIN1_EMAIL, password: env.ADMIN1_PASSWORD };

const raw = axios.create({ baseURL: BASE, adapter: 'http' }); // node http: no CORS, Set-Cookie readable
// the session is an httpOnly cookie; `cookie` is the raw "token=..." pair from Set-Cookie
export const as = (cookie) => axios.create({ baseURL: BASE, adapter: 'http', headers: cookie ? { Cookie: cookie } : {} });

let n = 0;
export const uid = (p = 'X') => `${p}${Date.now().toString(36)}${n++}`.toUpperCase();

export async function loginApi({ email, password }) {
  const res = await raw.post('/auth/login', { email, password });
  return { user: res.data.user, cookie: res.headers['set-cookie'][0].split(';')[0], setCookie: res.headers['set-cookie'] };
}
export const adminApi = async () => as((await loginApi(ADMIN)).cookie);

// creates + approves a normal (non-admin) user; returns { email, password, id }
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
      <AuthProvider><App /><HistoryButtons /></AuthProvider>
    </MemoryRouter>
  );
