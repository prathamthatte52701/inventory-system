// Shared integration harness: throwaway DB, seeded admin + one approved normal user.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
process.env.NODE_ENV = 'test';
const assert = require('assert');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const seedAdmins = require('../utils/seedAdmins');

// value of the token cookie set by a response (undefined if none / cleared)
const tokenFromHeaders = (headers) => {
  const c = (headers.getSetCookie ? headers.getSetCookie() : []).find((x) => x.startsWith('token='));
  return c ? c.slice(6, c.indexOf(';') === -1 ? undefined : c.indexOf(';')) || undefined : undefined;
};

module.exports = async function setup(label) {
  let base, pass = 0, fail = 0;
  await require('../config/db')({ dbName: process.env.TEST_DB || 'inventory_test' });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const server = app.listen(0);
  server.keepAliveTimeout = 60000; // node default 5s races undici keep-alive reuse -> spurious ECONNRESET under load
  base = `http://127.0.0.1:${server.address().port}/api`;

  const h = {
    assert, mongoose, base,
    t: async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } },
    is: (r, s) => assert.strictEqual(r.s, s, `expected ${s} got ${r.s} ${JSON.stringify(r.b)}`),
    near: (a, b, eps = 0.01) => assert(Math.abs(a - b) <= eps, `expected ~${b} got ${a}`),
    // token = raw JWT; it travels the way a browser would send it: in the "token" cookie
    call: async (method, path, body, token, raw) => {
      const r = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: 'token=' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (raw) return { s: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
      let b = null;
      try { b = await r.json(); } catch { /* empty */ }
      const out = { s: r.status, b, headers: r.headers, token: tokenFromHeaders(r.headers) };
      // Older tests treat GET /movements as "all movements": walk every page for them. Calls that pass page= or
      // limit= are left alone, so pagination tests see the real paginated envelope.
      if (method === 'GET' && /^[/]movements([?]|$)/.test(path) && out.s === 200 && b && Array.isArray(b.data)) out.paged = b; // the raw envelope, for pagination tests
      if (method === 'GET' && /^[/]movements([?]|$)/.test(path) && !/[?&](page|limit)=/.test(path) && out.s === 200 && b && Array.isArray(b.data)) {
        const sep = path.includes('?') ? '&' : '?';
        let all = [];
        const first = await (await fetch(base + path + sep + 'limit=200&page=1', { headers: token ? { Cookie: 'token=' + token } : {} })).json();
        all = first.data;
        for (let p = 2; p <= first.totalPages; p++) {
          const next = await (await fetch(base + path + sep + 'limit=200&page=' + p, { headers: token ? { Cookie: 'token=' + token } : {} })).json();
          all = all.concat(next.data);
        }
        out.b = all; out.paged = b;
      }
      return out;
    },
    finish: async () => {
      await mongoose.connection.dropDatabase();
      server.close();
      await mongoose.disconnect();
      console.log(`${label}: ${pass} pass, ${fail} fail`);
      process.exit(fail ? 1 : 0);
    },
  };
  await seedAdmins();
  h.admin = (await h.call('POST', '/auth/login', { email: process.env.ADMIN1_EMAIL, password: process.env.ADMIN1_PASSWORD })).token;
  const su = await h.call('POST', '/auth/signup', { name: 'Bob', email: 'bob@test.com', password: 'secret1' });
  await h.call('PATCH', `/users/${su.b.id}/approve`, undefined, h.admin);
  h.user = (await h.call('POST', '/auth/login', { email: 'bob@test.com', password: 'secret1' })).token;
  h.newMaterial = async (id, extra = {}) =>
    (await h.call('POST', '/materials', { materialId: id, description: 'Cement', unit: 'Bag', ...extra }, h.admin)).b._id;
  h.move = (material, type, quantity, rate, extra = {}, token = h.user) =>
    h.call('POST', '/movements', { material, type, quantity, ...(rate === undefined ? {} : { rate }), ...extra }, token);
  h.User = User;
  return h;
};
