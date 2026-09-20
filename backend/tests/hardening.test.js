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
  const many = await User.insertMany(Array.from({ length: 60 }, (_, i) => ({ name: `User${i}`, email: `bulk${i}@test.com`, passwordHash: 'x', status: i % 3 ? 'approved' : 'pending' })));
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
      for (let i = 0; i < 6; i++) codes.push((await call('POST', '/auth/signup', { name: 'Signer', email: `rl${i}@test.com`, password: 'Secret#123' })).s);
      assert.deepStrictEqual(codes, [201, 201, 201, 201, 201, 429]);
      const r = await call('POST', '/auth/signup', { name: 'Signer', email: 'rl-extra@test.com', password: 'Secret#123' });
      is(r, 429); assert(Number(r.headers.get('retry-after')) > 3000, 'Retry-After should be about an hour'); assert(/too many signups/i.test(r.b.message));
      assert(!(await User.exists({ email: 'rl-extra@test.com' })), 'refused signup must not create a user');
      // a burst is atomic: exactly the allowance gets through
      await LoginAttempt.deleteMany({ email: /^signup:/ });
      const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/auth/signup', { name: 'Burster', email: `burst${i}@test.com`, password: 'Secret#123' })));
      assert.strictEqual(burst.filter((x) => x.s === 201).length, 5); assert.strictEqual(burst.filter((x) => x.s === 429).length, 7);
      assert(burst.every((x) => [201, 429].includes(x.s)), 'no 500s allowed');
      // login is a separate key: unaffected by the signup lockout
      is(await call('POST', '/auth/login', { email: process.env.ADMIN1_EMAIL, password: process.env.ADMIN1_PASSWORD }), 200);
      // expiry: moving the stored deadline into the past frees the address again
      await LoginAttempt.updateOne({ email: /^signup:ip:/ }, { lockedUntil: new Date(Date.now() - 1000), windowStart: new Date(Date.now() - 2 * 3600 * 1000) });
      is(await call('POST', '/auth/signup', { name: 'Signer', email: 'rl-after@test.com', password: 'Secret#123' }), 201);
    } finally { process.env.SIGNUP_RATE_MAX = saved; await LoginAttempt.deleteMany({ email: /^signup:/ }); }
  });
  await t('signup: default limit is 5/hour when no env override; duplicate-email 409 and validation 400 unchanged', async () => {
    const saved = process.env.SIGNUP_RATE_MAX; delete process.env.SIGNUP_RATE_MAX;
    await LoginAttempt.deleteMany({ email: /^signup:/ });
    try {
      is(await call('POST', '/auth/signup', { name: 'Dupper', email: 'dup1@test.com', password: 'Secret#123' }), 201);
      is(await call('POST', '/auth/signup', { name: 'Dupper', email: 'DUP1@test.com', password: 'Secret#123' }), 409);
      is(await call('POST', '/auth/signup', { name: 'Dupper', email: 'bad', password: 'Secret#123' }), 400);
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

  // ============================================================ signup validation + user soft delete
  const ExcelJS = require('exceljs');
  const PW = 'Secret#123';
  const signup = (body) => call('POST', '/auth/signup', { name: 'Valid Name', email: 'v@test.com', password: PW, ...body });
  const msgs = (r) => JSON.stringify(r.b);
  const signupKeyDocs = () => LoginAttempt.countDocuments({ email: /^signup:/ });

  await t('signup: every weak password is rejected with the specific rule that failed (one case each)', async () => {
    await LoginAttempt.deleteMany({ email: /^signup:/ });
    const cases = [
      ['too short', 'Ab1!xyz', /8-32 characters/],
      ['too long', 'Aa1!' + 'x'.repeat(29), /8-32 characters/],
      ['no uppercase', 'secret#123', /uppercase/],
      ['no lowercase', 'SECRET#123', /lowercase/],
      ['no digit', 'Secret#abc', /digit/],
      ['no special character', 'Secret1234', /special character/],
      ['only letters', 'abcdefgh', /uppercase.*digit.*special/],
    ];
    for (const [label, password, re] of cases) {
      const r = await signup({ email: 'weak@test.com', password }); is(r, 400);
      assert(re.test(msgs(r)), label + ' -> ' + msgs(r));
      assert(!(await User.exists({ email: 'weak@test.com' })), label + ' created a user');
    }
    // boundaries: exactly 8 and exactly 32 characters are fine
    is(await signup({ email: 'pw8@test.com', password: 'Aa1!aaaa' }), 201);
    is(await signup({ email: 'pw32@test.com', password: 'Aa1!' + 'x'.repeat(28) }), 201);
    for (const bad of [null, 12345678, ['Secret#123'], { a: 1 }, undefined]) is(await signup({ email: 'type@test.com', password: bad }), 400);
    assert.strictEqual((await signup({ email: 'ok-pw@test.com', password: PW })).s, 201);
  });
  await t('signup: format is checked BEFORE the rate limiter, so rejected requests never burn a slot', async () => {
    const saved = process.env.SIGNUP_RATE_MAX; process.env.SIGNUP_RATE_MAX = '2';
    await LoginAttempt.deleteMany({ email: /^signup:/ });
    try {
      for (let i = 0; i < 6; i++) is(await signup({ email: 'burn@test.com', password: 'weak' }), 400);
      assert.strictEqual(await signupKeyDocs(), 0, 'a rejected request charged the limiter');
      is(await signup({ email: 'slot1@test.com' }), 201); is(await signup({ email: 'slot2@test.com' }), 201);
      is(await signup({ email: 'slot3@test.com' }), 429);
    } finally { process.env.SIGNUP_RATE_MAX = saved; await LoginAttempt.deleteMany({ email: /^signup:/ }); }
  });
  await t('signup: name must be 3-48 characters (trimmed)', async () => {
    for (const name of ['ab', 'a', '', '  ab  ', '  ', 'x'.repeat(49), 'y'.repeat(200)]) { const r = await signup({ email: 'nm@test.com', name }); is(r, 400); assert(/Name must be 3-48/.test(msgs(r)), name.length + ' -> ' + msgs(r)); }
    for (const name of [123, ['abc'], { a: 1 }, null]) is(await signup({ email: 'nm@test.com', name }), 400);
    is(await signup({ email: 'nm3@test.com', name: 'abc' }), 201);
    is(await signup({ email: 'nm48@test.com', name: 'n'.repeat(48) }), 201);
    assert.strictEqual((await User.findOne({ email: 'nm3@test.com' })).name, 'abc');
    // the model refuses bad data too, even from a script that skips the API
    await assert.rejects(() => User.create({ name: 'ab', email: 'model@test.com', passwordHash: 'x' }), /minlength|shorter/i);
    await assert.rejects(() => User.create({ name: 'n'.repeat(49), email: 'model2@test.com', passwordHash: 'x' }), /maxlength|longer/i);
  });
  await t('signup: malformed emails are rejected (API and model)', async () => {
    const bad = ['plain', 'a@b', '@x.com', 'a@.com', 'a b@x.com', 'a@x..com', 'a@-x.com', 'a@x.com.', 'a@@x.com', 'a@x_y.com', 'x'.repeat(250) + '@x.com', '', ' ', null, ['a@b.com'], { a: 1 }, 12];
    for (const email of bad) { const r = await signup({ email }); assert.strictEqual(r.s, 400, JSON.stringify(email) + ' -> ' + r.s); }
    is(await signup({ email: 'first.last+tag@sub.example.co.uk' }), 201);
    is(await signup({ email: "o'brien@x.com" }), 201);
    assert((await User.findOne({ email: 'first.last+tag@sub.example.co.uk' })), 'valid address stored');
    assert.strictEqual((await signup({ email: '  Padded@Test.com  ' })).s, 201);
    assert(await User.exists({ email: 'padded@test.com' }), 'email is trimmed and lower-cased before saving');
    await assert.rejects(() => User.create({ name: 'Model', email: 'not an email', passwordHash: 'x' }), /Invalid email/);
  });

  const mkUser = async (name, email) => {
    const s = await signup({ name, email }); is(s, 201);
    is(await call('PATCH', '/users/' + s.b.id + '/approve', undefined, A), 200);
    const l = await call('POST', '/auth/login', { email, password: PW }); is(l, 200);
    return { id: s.b.id, email, token: l.token };
  };
  const adminId = String((await User.findOne({ role: 'admin' }))._id);

  await t('deactivated user cannot log in, and the answer is byte-for-byte the wrong-password answer (no leak)', async () => {
    const u = await mkUser('Dee Active', 'deact1@test.com');
    is(await call('PATCH', '/users/' + u.id + '/deactivate', undefined, A), 200);
    const dead = await call('POST', '/auth/login', { email: u.email, password: PW }); // CORRECT password
    const wrong = await call('POST', '/auth/login', { email: u.email, password: 'Wrong#Pass1' });
    const ghost = await call('POST', '/auth/login', { email: 'nobody-here@test.com', password: PW });
    is(dead, 401); is(wrong, 401); is(ghost, 401);
    assert.deepStrictEqual(dead.b, wrong.b); assert.deepStrictEqual(dead.b, ghost.b);
    assert(!dead.token, 'no cookie for a deactivated account');
    assert(!/deactivat|inactive|disabled|suspend/i.test(JSON.stringify(dead.b)));
  });
  await t('a deactivated user\'s EXISTING session dies on its very next request (not just at next login)', async () => {
    const u = await mkUser('Live Session', 'deact2@test.com');
    is(await call('GET', '/auth/me', undefined, u.token), 200); is(await call('GET', '/materials', undefined, u.token), 200);
    is(await call('PATCH', '/users/' + u.id + '/deactivate', undefined, A), 200);
    for (const p of ['/auth/me', '/materials', '/movements', '/reports/dashboard']) is(await call('GET', p, undefined, u.token), 401);
    is(await call('POST', '/movements', { material: '0'.repeat(24), type: 'OUT', quantity: 1 }, u.token), 401);
    // an already-open admin session works the same way: demote-proof and deactivation-proof
    const a2 = await mkUser('Second Admin', 'deact3@test.com');
    is(await call('PATCH', '/users/' + a2.id + '/role', { role: 'admin' }, A), 200);
    is(await call('GET', '/users', undefined, a2.token), 200);
    is(await call('PATCH', '/users/' + a2.id + '/deactivate', undefined, A), 200);
    is(await call('GET', '/users', undefined, a2.token), 401);
    is(await call('PATCH', '/users/' + adminId + '/deactivate', undefined, a2.token), 401); // and it can not act as an admin any more
    assert.strictEqual((await User.findById(adminId)).active, true);
  });
  await t('an admin cannot deactivate their own account (any id casing); state untouched', async () => {
    for (const id of [adminId, adminId.toUpperCase()]) {
      const r = await call('PATCH', '/users/' + id + '/deactivate', undefined, A); is(r, 400);
      assert(/cannot deactivate your own/i.test(r.b.message), r.b.message);
    }
    assert.strictEqual((await User.findById(adminId)).active, true);
    is(await call('GET', '/auth/me', undefined, A), 200);
  });
  await t('deactivate -> reactivate round trip; five past movements and the audit trail stay intact and attributed', async () => {
    const u = await mkUser('Mover Mike', 'mover@test.com');
    const mat = await h.newMaterial('SOFTDEL', { description: 'Soft delete probe', unit: 'Nos' });
    const ids = [];
    for (let i = 0; i < 5; i++) { const r = await h.move(mat, i % 2 ? 'OUT' : 'IN', 3 + i, i % 2 ? undefined : 10, { movementDate: '2026-04-0' + (i + 1) }, u.token); is(r, 201); ids.push(r.b.movement._id); }
    const attributed = async (label) => {
      const l = (await call('GET', '/movements?material=' + mat, undefined, A)).b;
      assert.strictEqual(l.length, 5, label + ': movements vanished');
      assert(l.every((m) => m.createdBy && m.createdBy.name === 'Mover Mike'), label + ': createdBy lost -> ' + JSON.stringify(l.map((m) => m.createdBy)));
      const x = await call('GET', '/reports/movements/excel?material=' + mat, undefined, A, true); is(x, 200);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf); const ws = wb.worksheets[0];
      assert.strictEqual(ws.rowCount, 6, label + ': export rows');
      for (let r = 2; r <= 6; r++) assert.strictEqual(ws.getRow(r).getCell(9).value, 'Mover Mike', label + ': export "Entered By" row ' + r);
      const au = (await call('GET', '/audit?user=' + u.id + '&limit=200', undefined, A)).b;
      assert(au.total >= 6 && au.data.every((e) => e.userEmail === 'mover@test.com'), label + ': audit trail lost');
      const act = await call('GET', '/users/' + u.id + '/activity', undefined, A); is(act, 200); assert.strictEqual(act.b.movementCount, 5);
    };
    await attributed('before');
    const d = await call('PATCH', '/users/' + u.id + '/deactivate', undefined, A); is(d, 200); assert.strictEqual(d.b.active, false);
    assert.strictEqual((await User.findById(u.id)).active, false);
    await attributed('while deactivated');
    assert.strictEqual((await call('GET', '/users?limit=200', undefined, A)).b.data.find((x) => x._id === u.id).active, false, 'list shows the state');
    const r = await call('PATCH', '/users/' + u.id + '/reactivate', undefined, A); is(r, 200); assert.strictEqual(r.b.active, true);
    await attributed('after reactivation');
    const login = await call('POST', '/auth/login', { email: u.email, password: PW }); is(login, 200); // can sign in again
    is(await call('GET', '/auth/me', undefined, login.token), 200);
    // the movement the user posted before is still theirs and the ledger math is unchanged
    const mat2 = (await call('GET', '/materials/' + mat, undefined, A)).b; assert.strictEqual(mat2.currentQuantity, 5); // 3 - 4 + 5 - 6 + 7, unchanged by the deactivation
    for (const action of ['USER_DEACTIVATE', 'USER_REACTIVATE']) assert(await AuditLog.exists({ action, entityId: u.id }), action + ' not audited');
  });
  await t('deactivate/reactivate BREAK: twice, already active, unknown id, junk ids, wrong role, no token: clean codes, never a 500', async () => {
    const u = await mkUser('Twice Tom', 'twice@test.com');
    is(await call('PATCH', '/users/' + u.id + '/reactivate', undefined, A), 409);          // already active
    is(await call('PATCH', '/users/' + u.id + '/deactivate', undefined, A), 200);
    const again = await call('PATCH', '/users/' + u.id + '/deactivate', undefined, A); is(again, 409); assert(/already deactivated/i.test(again.b.message));
    is(await call('PATCH', '/users/' + u.id + '/reactivate', undefined, A), 200);
    const once = await call('PATCH', '/users/' + u.id + '/reactivate', undefined, A); is(once, 409); assert(/already active/i.test(once.b.message));
    const ghost = String(new mongoose.Types.ObjectId());
    is(await call('PATCH', '/users/' + ghost + '/deactivate', undefined, A), 404); is(await call('PATCH', '/users/' + ghost + '/reactivate', undefined, A), 404);
    for (const bad of ['xyz', '123', 'g'.repeat(24), 'x'.repeat(5000)]) { is(await call('PATCH', '/users/' + bad + '/deactivate', undefined, A), 400); is(await call('PATCH', '/users/' + bad + '/reactivate', undefined, A), 400); }
    is(await call('PATCH', '/users/' + u.id + '/deactivate', undefined, U), 403); is(await call('PATCH', '/users/' + u.id + '/reactivate', undefined, U), 403);
    is(await call('PATCH', '/users/' + u.id + '/deactivate'), 401);
    assert.strictEqual((await User.findById(u.id)).active, true, 'refused calls must not change anything');
    // a legacy account created before the field existed (no "active" at all) counts as active and can be deactivated
    const legacy = (await User.collection.insertOne({ name: 'Legacy Lee', email: 'legacy@test.com', passwordHash: 'x', role: 'user', status: 'approved', createdAt: new Date(), updatedAt: new Date() })).insertedId;
    assert.strictEqual((await User.collection.findOne({ _id: legacy })).active, undefined);
    is(await call('PATCH', '/users/' + legacy + '/reactivate', undefined, A), 409);
    is(await call('PATCH', '/users/' + legacy + '/deactivate', undefined, A), 200);
    assert.strictEqual((await User.collection.findOne({ _id: legacy })).active, false);
  });
  await t('rejected/pending signups can also be deactivated independently of their approval status', async () => {
    const s = await signup({ email: 'pend-deact@test.com' }); is(s, 201);
    is(await call('PATCH', '/users/' + s.b.id + '/deactivate', undefined, A), 200);
    const u = await User.findById(s.b.id); assert.strictEqual(u.status, 'pending'); assert.strictEqual(u.active, false);
    is(await call('PATCH', '/users/' + s.b.id + '/approve', undefined, A), 200); // approval history is a separate axis
    assert.strictEqual((await User.findById(s.b.id)).active, false);
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
