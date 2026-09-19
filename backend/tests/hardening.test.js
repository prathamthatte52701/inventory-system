// Audit follow-ups: /users pagination, signup rate limit, new indexes, generic material validation message,
// shared pagination/error helpers. Own DB name so it can run beside other suites.
process.env.TEST_DB = 'inventory_test_hardening';
const setup = require('./harness');
const Material = require('../models/Material');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const LoginAttempt = require('../models/LoginAttempt');
const { paginate, positiveInt, pageEnvelope, MAX_LIMIT, DEFAULT_LIMIT } = require('../utils/pagination');
const { httpError, fail, wrap } = require('../utils/errors');

(async () => {
  const h = await setup('hardening');
  const { t, is, call, assert, mongoose } = h;
  const A = h.admin, U = h.user;

  // ---------- shared helpers ----------
  await t('pagination helper: defaults, clamp, 400 on garbage, skip maths', () => {
    assert.deepStrictEqual(paginate({}), { page: 1, limit: DEFAULT_LIMIT, skip: 0 });
    assert.deepStrictEqual(paginate({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20 });
    assert.strictEqual(paginate({ limit: '99999' }).limit, MAX_LIMIT);
    for (const bad of ['0', '-1', 'abc', '1.5', '', '1e2', ['1'], {}, ' 2']) {
      assert.throws(() => paginate({ page: bad }), (e) => e.status === 400 && /positive whole number/.test(e.message), `page=${JSON.stringify(bad)}`);
    }
    assert.strictEqual(positiveInt(undefined, 7, 'x'), 7);
    assert.deepStrictEqual(pageEnvelope([1], { page: 2, limit: 5 }, 11), { data: [1], page: 2, limit: 5, total: 11, totalPages: 3 });
  });
  await t('errors helper: fail() sends status+message, wrap() maps httpError -> JSON and others -> next()', async () => {
    const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, headersSent: false };
    fail(res, 418, 'teapot'); assert.deepStrictEqual([res.code, res.body], [418, { message: 'teapot' }]);
    const r2 = { ...res, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await wrap(async () => { throw httpError(409, 'clash'); })({}, r2, () => assert.fail('next must not run'));
    assert.deepStrictEqual([r2.code, r2.body], [409, { message: 'clash' }]);
    let nexted = null; await wrap(async () => { throw new Error('boom'); })({}, { ...res }, (e) => { nexted = e; });
    assert.strictEqual(nexted.message, 'boom');
    // streaming case: headers already sent -> logged with the label, connection destroyed, no JSON attempted
    const logs = []; const orig = console.error; console.error = (...a) => logs.push(a);
    let destroyed = null; const r3 = { headersSent: true, destroy(e) { destroyed = e; }, status() { assert.fail('no json after headers'); } };
    try { await wrap(async () => { throw new Error('stream died'); }, 'report export failed')({}, r3, () => assert.fail('no next')); } finally { console.error = orig; }
    assert.strictEqual(destroyed.message, 'stream died');
    assert(logs.some((l) => l[0] === '[report export failed]' && l[1].message === 'stream died'), 'missing server-side log');
  });

  // ---------- GET /users pagination ----------
  const many = await User.insertMany(Array.from({ length: 60 }, (_, i) => ({ name: `P${i}`, email: `bulk${i}@test.com`, passwordHash: 'x', status: i % 3 ? 'approved' : 'pending' })));
  const total = await User.countDocuments({});
  await t('GET /users returns the paginated envelope (default 50) and never a bare array', async () => {
    const r = await call('GET', '/users?page=1&limit=1', undefined, A); is(r, 200);
    assert(!Array.isArray(r.paged) && Array.isArray(r.paged.data));
    assert.deepStrictEqual([r.paged.page, r.paged.limit, r.paged.data.length, r.paged.total, r.paged.totalPages], [1, 1, 1, total, total]);
    const d = (await call('GET', '/users', undefined, A)).paged;
    assert.deepStrictEqual([d.page, d.limit, d.data.length, d.total], [1, 50, 50, total]);
    assert(d.data.every((u) => !('passwordHash' in u) && !('tokenVersion' in u)));
  });
  await t('GET /users: pages concatenate to the full ordered list, no duplicates; ?status filter still works with paging', async () => {
    const want = (await User.find({}).sort({ createdAt: -1, _id: -1 }).lean()).map((u) => String(u._id));
    const got = [];
    for (let p = 1; p <= Math.ceil(total / 25); p++) got.push(...(await call('GET', `/users?limit=25&page=${p}`, undefined, A)).paged.data.map((u) => u._id));
    assert.deepStrictEqual(got, want);
    const pend = (await call('GET', '/users?status=pending&limit=5&page=2', undefined, A)).paged;
    assert(pend.data.length === 5 && pend.data.every((u) => u.status === 'pending'));
    assert.strictEqual(pend.total, await User.countDocuments({ status: 'pending' }));
  });
  await t('GET /users BREAK: page=-1, page=0, junk, huge limit -> 400 or clamped, never a crash or an oversized page', async () => {
    for (const q of ['page=-1', 'page=0', 'page=abc', 'limit=0', 'limit=-5', 'page=1.5', 'page=1&page=2', 'page=99999999999999999999']) {
      const r = await call('GET', `/users?${q}`, undefined, A); assert.strictEqual(r.s, 400, `${q} -> ${r.s}`);
    }
    const big = await call('GET', '/users?page=-1&limit=99999', undefined, A); assert.strictEqual(big.s, 400); // bad page wins, still a clean 400
    const clamped = (await call('GET', '/users?limit=99999', undefined, A)).paged; assert.strictEqual(clamped.limit, 200); assert(clamped.data.length <= 200);
    const past = (await call('GET', '/users?page=9999', undefined, A)); is(past, 200); assert.deepStrictEqual(past.paged.data, []);
    is(await call('GET', '/users?page=1', undefined, U), 403); is(await call('GET', '/users?page=1'), 401);
    assert.strictEqual((await call('GET', '/users?status[$ne]=x', undefined, A)).s, 200); // operator-injection attempt is just an unknown key
  });

  // ---------- signup rate limit ----------
  await t('signup: 6th rapid signup from one key is refused (429 + Retry-After), earlier ones succeed, others unaffected', async () => {
    const saved = process.env.SIGNUP_RATE_MAX; process.env.SIGNUP_RATE_MAX = '5';
    await LoginAttempt.deleteMany({ email: /^signup:/ });
    try {
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await call('POST', '/auth/signup', { name: 'S', email: `rl${i}@test.com`, password: 'secret1' })).s);
      assert.deepStrictEqual(codes, [201, 201, 201, 201, 201, 429]);
      const r = await call('POST', '/auth/signup', { name: 'S', email: 'rl-extra@test.com', password: 'secret1' });
      is(r, 429); assert(Number(r.headers.get('retry-after')) > 3000, 'Retry-After should be about an hour'); assert(/too many signups/i.test(r.b.message));
      assert(!(await User.exists({ email: 'rl-extra@test.com' })), 'refused signup must not create a user');
      // a burst is atomic: exactly the allowance gets through
      await LoginAttempt.deleteMany({ email: /^signup:/ });
      const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/auth/signup', { name: 'B', email: `burst${i}@test.com`, password: 'secret1' })));
      assert.strictEqual(burst.filter((x) => x.s === 201).length, 5); assert.strictEqual(burst.filter((x) => x.s === 429).length, 7);
      assert(burst.every((x) => [201, 429].includes(x.s)), 'no 500s allowed');
      // login is a separate key: unaffected by the signup lockout
      is(await call('POST', '/auth/login', { email: process.env.ADMIN1_EMAIL, password: process.env.ADMIN1_PASSWORD }), 200);
      // expiry: moving the stored deadline into the past frees the address again
      await LoginAttempt.updateOne({ email: /^signup:ip:/ }, { lockedUntil: new Date(Date.now() - 1000), windowStart: new Date(Date.now() - 2 * 3600 * 1000) });
      is(await call('POST', '/auth/signup', { name: 'S', email: 'rl-after@test.com', password: 'secret1' }), 201);
    } finally { process.env.SIGNUP_RATE_MAX = saved; await LoginAttempt.deleteMany({ email: /^signup:/ }); }
  });
  await t('signup: default limit is 5/hour when no env override; duplicate-email 409 and validation 400 unchanged', async () => {
    const saved = process.env.SIGNUP_RATE_MAX; delete process.env.SIGNUP_RATE_MAX;
    await LoginAttempt.deleteMany({ email: /^signup:/ });
    try {
      is(await call('POST', '/auth/signup', { name: 'D', email: 'dup1@test.com', password: 'secret1' }), 201);
      is(await call('POST', '/auth/signup', { name: 'D', email: 'DUP1@test.com', password: 'secret1' }), 409);
      is(await call('POST', '/auth/signup', { name: 'D', email: 'bad', password: 'secret1' }), 400);
      const a = await LoginAttempt.findOne({ email: /^signup:ip:/ }).lean(); assert(a && a.failures >= 2, 'signup attempts are stored in MongoDB');
      assert(a.expireAt && a.expireAt - a.windowStart >= 3600 * 1000 - 5, 'TTL uses the 1 hour window');
    } finally { process.env.SIGNUP_RATE_MAX = saved; await LoginAttempt.deleteMany({ email: /^signup:/ }); }
  });
  await t('login limiter untouched: 5 wrong then 429 (own key namespace, same 15 minute window)', async () => {
    for (let i = 0; i < 5; i++) is(await call('POST', '/auth/login', { email: 'nobody@test.com', password: 'x' }), 401);
    const r = await call('POST', '/auth/login', { email: 'nobody@test.com', password: 'x' }); is(r, 429);
    assert(Number(r.headers.get('retry-after')) <= 900);
  });

  // ---------- indexes ----------
  await t('new indexes exist on the real collections', async () => {
    for (const m of [AuditLog, User, Material]) await m.init();
    const keys = async (m) => (await m.collection.indexes()).map((i) => JSON.stringify(i.key));
    const a = await keys(AuditLog), u = await keys(User), m = await keys(Material);
    assert(a.includes('{"user":1}') && a.includes('{"action":1}'), 'AuditLog: ' + a);
    assert(u.includes('{"status":1}'), 'User: ' + u);
    assert(m.includes('{"isActive":1}'), 'Material: ' + m);
    assert(a.includes('{"createdAt":1}') && m.includes('{"materialId":1}'), 'existing indexes kept');
  });

  // ---------- material validation leak ----------
  await t('material: a Mongoose ValidationError is reported generically (and logged server-side), never leaked', async () => {
    const ctl = require('../controllers/materialController');
    const adminId = (await User.findOne({ role: 'admin' }))._id;
    const mk = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
    const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
    try {
      // bypasses the route validators on purpose, to reach the schema-level failure
      const res = mk();
      await ctl.create({ body: { materialId: 'LEAK1', description: 'd', unit: 'u', openingRate: -5 }, user: { _id: adminId } }, res, (e) => { throw e; });
      assert.strictEqual(res.code, 400);
      assert.deepStrictEqual(res.body, { message: 'Invalid material data' });
      assert(!/openingRate|Path|validation failed|Material/.test(JSON.stringify(res.body)), 'schema internals leaked');
      assert(logs.some((l) => /openingRate/.test(l)), 'the detail must still be logged server-side');
      const ok = await Material.create({ materialId: 'LEAK2', description: 'd', unit: 'u' });
      const res2 = mk();
      await ctl.update({ params: { id: String(ok._id) }, body: { minimumQuantity: -1 }, user: { _id: adminId } }, res2, (e) => { throw e; });
      assert.deepStrictEqual([res2.code, res2.body], [400, { message: 'Invalid material data' }]);
    } finally { console.error = orig; }
    // through the real HTTP route the payload is stopped by the request validators with structured (non-Mongoose) errors
    const r = await call('POST', '/materials', { materialId: 'X', description: 5, unit: [], openingRate: 'abc' }, A);
    is(r, 400); assert(!/Cast to|Path `|Material validation failed/i.test(JSON.stringify(r.b)), JSON.stringify(r.b));
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
