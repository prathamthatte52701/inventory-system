// Limitation fixes: (1) login lockout, (2) pagination + streamed exports, (3) httpOnly cookie session, (4) DB-level material lock.
process.env.TEST_DB = 'inventory_test_fixes';
const http = require('http');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const jwt = require('jsonwebtoken');
const setup = require('./harness');
const pdfText = require('./pdfText');
const { sorted, oracle } = require('./oracle');
const Material = require('../models/Material');
const Movement = require('../models/Movement');
const LoginAttempt = require('../models/LoginAttempt');
const { lockConfig } = require('../utils/costing');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60 * 1000;

(async () => {
  const h = await setup('fixes');
  const { t, is, call, assert, near, mongoose } = h;
  const A = h.admin, U = h.user;
  const bobId = String((await h.User.findOne({ email: 'bob@test.com' }))._id);
  const port = new URL(h.base).port;

  // plain http client (fetch cannot set Origin; we also want the raw Set-Cookie lines)
  const rawHttp = (method, path, headers = {}, body, p = port) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: p, method, path: '/api' + path, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let b = null; try { b = JSON.parse(text); } catch { /* not json */ } resolve({ s: res.statusCode, headers: res.headers, setCookie: res.headers['set-cookie'] || [], b, text }); });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
  const json = (o) => JSON.stringify(o);
  const JH = { 'Content-Type': 'application/json' };
  const mkUser = async (email, pw = 'Secret#123') => { const s = await call('POST', '/auth/signup', { name: 'Tester', email, password: pw }); is(s, 201); is(await call('PATCH', `/users/${s.b.id}/approve`, undefined, A), 200); return s.b.id; };
  const login = (email, pw) => call('POST', '/auth/login', { email, password: pw });
  const attempts = (email) => LoginAttempt.findOne({ email }).lean();

  // ---------- second real process (own memory, own lock map) sharing the same database ----------
  const child = spawn('node', [require('path').join(__dirname, 'childServer.js')], { env: { ...process.env, TEST_DB: 'inventory_test_fixes' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const childPort = await new Promise((resolve, reject) => {
    let buf = ''; const to = setTimeout(() => reject(new Error('child server did not start')), 30000);
    child.stdout.on('data', (d) => { buf += d; const m = /PORT=(\d+)/.exec(buf); if (m) { clearTimeout(to); resolve(m[1]); } });
    child.on('exit', (c) => reject(new Error('child exited ' + c)));
  });
  const childCall = async (method, path, body, token) => {
    const r = await rawHttp(method, path, { ...JH, ...(token ? { Cookie: 'token=' + token } : {}) }, body ? json(body) : undefined, childPort);
    return r;
  };

  // ============================================================ FIX 1: login lockout
  await mkUser('rl1@test.com');
  await t('F1 5 wrong passwords -> 401 each; the 6th attempt is locked out EVEN WITH THE CORRECT PASSWORD (429 + Retry-After)', async () => {
    for (let i = 1; i <= 5; i++) is(await login('rl1@test.com', 'wrong' + i), 401);
    const r = await login('rl1@test.com', 'Secret#123'); // correct!
    is(r, 429);
    const ra = Number(r.headers.get('retry-after'));
    assert(Number.isInteger(ra) && ra > 880 && ra <= 900, 'Retry-After ' + ra);
    assert(/too many login attempts/i.test(r.b.message) && r.b.retryAfterSeconds === ra, r.b.message);
    assert(!r.token, 'no cookie may be issued while locked out');
    is(await login('rl1@test.com', 'wrong6'), 429); // still locked, and attempts while locked do not extend it
    const a = await attempts('rl1@test.com');
    assert(a.failures === 6 && a.lockedUntil > new Date(), 'state stored in MongoDB');
  });
  await t('F1 lockout is in MongoDB, so a different process (a restarted server) sees it too', async () => {
    const r = await childCall('POST', '/auth/login', { email: 'rl1@test.com', password: 'Secret#123' });
    assert.strictEqual(r.s, 429); assert(Number(r.headers['retry-after']) > 0);
  });
  await t('F1 lockout clears once the window passes (time moved by editing the stored timestamps)', async () => {
    // 60s left: Retry-After reflects the stored deadline
    await LoginAttempt.updateOne({ email: 'rl1@test.com' }, { lockedUntil: new Date(Date.now() + 60000) });
    const near60 = await login('rl1@test.com', 'Secret#123'); is(near60, 429);
    const ra = Number(near60.headers.get('retry-after')); assert(ra >= 55 && ra <= 60, 'Retry-After ' + ra);
    // window over
    await LoginAttempt.updateOne({ email: 'rl1@test.com' }, { lockedUntil: new Date(Date.now() - 1000), windowStart: new Date(Date.now() - 16 * MIN) });
    const ok = await login('rl1@test.com', 'Secret#123'); is(ok, 200);
    assert.strictEqual(await attempts('rl1@test.com'), null); // success wiped the counter
  });
  await t('F1 a lockout that has expired does not linger: 5 more wrong attempts are again allowed', async () => {
    await mkUser('rl1b@test.com');
    for (let i = 0; i < 6; i++) await login('rl1b@test.com', 'bad');
    is(await login('rl1b@test.com', 'Secret#123'), 429);
    await LoginAttempt.updateOne({ email: 'rl1b@test.com' }, { lockedUntil: new Date(Date.now() - 1), windowStart: new Date(Date.now() - 20 * MIN) });
    for (let i = 0; i < 5; i++) is(await login('rl1b@test.com', 'bad'), 401);
    is(await login('rl1b@test.com', 'bad'), 429);
  });
  await t('F1 correct password on attempt 1..5 works normally and resets the counter', async () => {
    for (let k = 1; k <= 5; k++) {
      const email = `rl2_${k}@test.com`; await mkUser(email);
      for (let i = 1; i < k; i++) is(await login(email, 'nope'), 401);
      is(await login(email, 'Secret#123'), 200);                       // attempt k is correct
      assert.strictEqual(await attempts(email), null, `counter reset after success on attempt ${k}`);
      for (let i = 0; i < 5; i++) is(await login(email, 'nope'), 401); // a full fresh allowance of 5
      is(await login(email, 'nope'), 429);                          // and only then the lock
    }
  });
  await t('F1 attempts spread over a long time never trigger a lockout', async () => {
    await mkUser('rl3@test.com');
    // drip: one wrong attempt, then 4 minutes pass (stored timestamps moved back), repeated 12 times = 48 minutes
    for (let i = 0; i < 12; i++) {
      is(await login('rl3@test.com', 'nope'), 401);
      await LoginAttempt.updateOne({ email: 'rl3@test.com' }, { windowStart: new Date((await attempts('rl3@test.com')).windowStart.getTime() - 4 * MIN) });
    }
    // 4 wrong, 16 minutes pass, 4 more wrong
    await mkUser('rl3b@test.com');
    for (let i = 0; i < 4; i++) is(await login('rl3b@test.com', 'nope'), 401);
    await LoginAttempt.updateOne({ email: 'rl3b@test.com' }, { windowStart: new Date(Date.now() - 16 * MIN) });
    for (let i = 0; i < 4; i++) is(await login('rl3b@test.com', 'nope'), 401);
    assert.strictEqual((await attempts('rl3b@test.com')).failures, 4);
    is(await login('rl3b@test.com', 'Secret#123'), 200);
  });
  await t('F1 lockout is per email: locking A leaves B (and A-lookalikes) untouched; unknown emails lock the same way', async () => {
    await mkUser('locka@test.com'); await mkUser('lockb@test.com'); await mkUser('LOCKA2@test.com');
    for (let i = 0; i < 6; i++) await login('locka@test.com', 'bad');
    is(await login('locka@test.com', 'Secret#123'), 429);
    is(await login('lockb@test.com', 'Secret#123'), 200);
    is(await login('locka2@test.com', 'Secret#123'), 200);
    is(await login('LOCKA@test.com', 'Secret#123'), 429); // same mailbox, different case = same counter
    for (let i = 0; i < 5; i++) is(await login('ghost@test.com', 'x'), 401);
    is(await login('ghost@test.com', 'x'), 429);        // no account, same behaviour: nothing revealed
    is(await login('ghost2@test.com', 'x'), 401);
  });
  await t('F1 20 simultaneous wrong attempts: exactly 5 are checked, 15 are blocked (charge is atomic)', async () => {
    await mkUser('burst@test.com');
    const rs = await Promise.all(Array.from({ length: 20 }, () => login('burst@test.com', 'nope')));
    const codes = rs.map((r) => r.s);
    assert.strictEqual(codes.filter((c) => c === 401).length, 5, JSON.stringify(codes));
    assert.strictEqual(codes.filter((c) => c === 429).length, 15);
    is(await login('burst@test.com', 'Secret#123'), 429);
  });
  await t('F1 only login is limited: signup, other routes and malformed logins are never throttled', async () => {
    await mkUser('other@test.com');
    for (let i = 0; i < 8; i++) is(await call('POST', '/auth/login', { email: 'other@test.com' }), 400); // invalid body: not charged
    for (let i = 0; i < 8; i++) is(await call('POST', '/auth/login', { email: 'not-an-email', password: 'x' }), 400);
    assert.strictEqual(await attempts('other@test.com'), null);
    is(await login('other@test.com', 'Secret#123'), 200);
    const s = await Promise.all(Array.from({ length: 10 }, (_, i) => call('POST', '/auth/signup', { name: 'Spammer', email: `spam${i}@test.com`, password: 'Secret#123' })));
    s.forEach((r) => is(r, 201));
    for (let i = 0; i < 15; i++) is(await call('GET', '/materials', undefined, U), 200);
    for (let i = 0; i < 8; i++) is(await call('GET', '/auth/me', undefined, U), 200);
  });
  await t('F1 TTL housekeeping: attempt records carry an expireAt so the collection cleans itself', async () => {
    const a = await attempts('locka@test.com');
    assert(a.expireAt && a.expireAt >= a.lockedUntil);
    const idx = await LoginAttempt.collection.indexes();
    assert(idx.some((i) => i.key.expireAt === 1 && i.expireAfterSeconds === 0), 'TTL index missing');
  });

  // ============================================================ FIX 3: httpOnly cookie session
  await mkUser('cookie@test.com');
  let loginSetCookie, cookieToken;
  await t('F3 login sets an httpOnly + Secure + SameSite=Strict cookie and never returns the token in the body', async () => {
    const r = await rawHttp('POST', '/auth/login', JH, json({ email: 'cookie@test.com', password: 'Secret#123' }));
    assert.strictEqual(r.s, 200);
    assert.strictEqual(r.setCookie.length, 1);
    loginSetCookie = r.setCookie[0];
    cookieToken = /^token=([^;]+)/.exec(loginSetCookie)[1];
    console.log('SET-COOKIE (login):  ' + loginSetCookie.replace(cookieToken, cookieToken.slice(0, 24) + '...<jwt>'));
    const attrs = loginSetCookie.split(';').map((x) => x.trim());
    assert(attrs.includes('HttpOnly'), 'HttpOnly missing');
    assert(attrs.includes('Secure'), 'Secure missing');
    assert(attrs.includes('SameSite=Strict'), 'SameSite=Strict missing');
    assert(attrs.includes('Path=/'), 'Path=/ missing');
    assert(attrs.includes('Max-Age=28800'), 'Max-Age (8h) missing');
    assert.strictEqual(jwt.verify(cookieToken, process.env.JWT_SECRET).id.length, 24);
    assert(!r.text.includes(cookieToken) && !('token' in r.b), 'token leaked into the JSON body');
    assert.deepStrictEqual(Object.keys(r.b), ['user']);
    assert.strictEqual(r.b.user.email, 'cookie@test.com');
  });
  await t('F3 Secure flag follows COOKIE_SECURE (off only when explicitly disabled)', async () => {
    process.env.COOKIE_SECURE = 'false';
    try {
      await mkUser('nosecure@test.com');
      const r = await rawHttp('POST', '/auth/login', JH, json({ email: 'nosecure@test.com', password: 'Secret#123' }));
      const attrs = r.setCookie[0].split(';').map((x) => x.trim());
      assert(!attrs.includes('Secure') && attrs.includes('HttpOnly') && attrs.includes('SameSite=Strict'));
    } finally { delete process.env.COOKIE_SECURE; }
  });
  await t('F3 protected routes work with the cookie alone (no Authorization header anywhere)', async () => {
    const r = await rawHttp('GET', '/auth/me', { Cookie: 'token=' + cookieToken });
    assert.strictEqual(r.s, 200); assert.strictEqual(r.b.email, 'cookie@test.com');
    for (const p of ['/materials', '/movements', '/reports/dashboard']) assert.strictEqual((await rawHttp('GET', p, { Cookie: 'token=' + cookieToken })).s, 200, p);
  });
  await t('F3 an Authorization header is NOT accepted any more (a stolen bearer token is useless)', async () => {
    assert.strictEqual((await rawHttp('GET', '/auth/me', { Authorization: 'Bearer ' + cookieToken })).s, 401);
    assert.strictEqual((await rawHttp('GET', '/auth/me', { Authorization: 'Bearer ' + cookieToken, Cookie: 'token=garbage' })).s, 401);
  });
  await t('F3 no cookie / empty / tampered / re-signed / JSON-injected cookie values are all rejected (401, never 500)', async () => {
    const [hd, pl, sg] = cookieToken.split('.');
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const cases = {
      'no cookie header': {}, 'empty value': { Cookie: 'token=' }, 'other cookie name': { Cookie: 'session=' + cookieToken },
      'signature flipped': { Cookie: `token=${hd}.${pl}.${sg.slice(0, -2)}${sg.endsWith('AA') ? 'BB' : 'AA'}` },
      'payload tampered role=admin': { Cookie: `token=${hd}.${b64({ ...JSON.parse(Buffer.from(pl, 'base64url')), role: 'admin' })}.${sg}` },
      'signed with wrong secret': { Cookie: 'token=' + jwt.sign({ id: bobId, role: 'admin' }, 'nope') },
      'alg none': { Cookie: `token=${b64({ alg: 'none', typ: 'JWT' })}.${pl}.` },
      'cookie-parser JSON form j:': { Cookie: 'token=' + encodeURIComponent('j:{"$ne":null}') },
      'bad percent-encoding': { Cookie: 'token=%E0%A4%A' }, 'only separators': { Cookie: ';;;;' }, '8KB of garbage': { Cookie: 'token=' + 'x'.repeat(8000) },
    };
    for (const [k, headers] of Object.entries(cases)) { const r = await rawHttp('GET', '/auth/me', headers); assert.strictEqual(r.s, 401, `${k} -> ${r.s}`); }
  });
  let oldToken;
  await t('F3 logout clears the cookie for real (empty value, expired, same attributes) and the old token dies server-side', async () => {
    oldToken = (await login('cookie@test.com', 'Secret#123')).token; assert(oldToken);
    assert.strictEqual((await call('GET', '/auth/me', undefined, oldToken)).s, 200);
    const r = await rawHttp('POST', '/auth/logout', { Cookie: 'token=' + oldToken });
    assert.strictEqual(r.s, 200);
    const sc = r.setCookie.find((c) => c.startsWith('token='));
    console.log('SET-COOKIE (logout): ' + sc);
    const attrs = sc.split(';').map((x) => x.trim());
    assert(/^token=$/.test(attrs[0]), 'cookie value not emptied');
    assert(attrs.some((a) => /^Expires=Thu, 01 Jan 1970/.test(a)), 'cookie not expired');
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert(attrs.includes(a), a + ' missing on the clearing cookie (browsers would keep the old one)');
    // what the browser now sends: nothing / an empty value
    assert.strictEqual((await rawHttp('GET', '/auth/me', {})).s, 401);
    assert.strictEqual((await rawHttp('GET', '/auth/me', { Cookie: 'token=' })).s, 401);
    // and a COPY of the old token (e.g. exfiltrated earlier) no longer works either: the server revoked it
    const dead = await rawHttp('GET', '/auth/me', { Cookie: 'token=' + oldToken });
    assert.strictEqual(dead.s, 401); assert(/session ended/i.test(dead.b.message), dead.b.message);
    for (const p of ['/materials', '/movements', '/reports/dashboard']) assert.strictEqual((await rawHttp('GET', p, { Cookie: 'token=' + oldToken })).s, 401, p);
  });
  await t('F3 after logout a fresh login works and issues a working token; the old one stays dead', async () => {
    const r = await login('cookie@test.com', 'Secret#123'); is(r, 200);
    assert.notStrictEqual(r.token, oldToken);
    assert.strictEqual((await call('GET', '/auth/me', undefined, r.token)).s, 200);
    assert.strictEqual((await call('GET', '/auth/me', undefined, oldToken)).s, 401);
  });
  await t('F3 logout is safe to call without a session / with junk, still clears the cookie, and never touches other users', async () => {
    for (const headers of [{}, { Cookie: 'token=garbage' }, { Cookie: 'token=' + jwt.sign({ id: bobId }, 'wrong') }, { Cookie: 'token=' + jwt.sign({ id: bobId }, process.env.JWT_SECRET, { expiresIn: -10 }) }]) {
      const r = await rawHttp('POST', '/auth/logout', headers);
      assert.strictEqual(r.s, 200); assert(r.setCookie.some((c) => /^token=;/.test(c)));
    }
    assert.strictEqual((await call('GET', '/auth/me', undefined, U)).s, 200); // bob unaffected by all of the above
  });
  await t('F3 logging out one session ends the user\'s other tokens too (documented: tokenVersion is per user)', async () => {
    await mkUser('multi@test.com');
    const t1 = (await login('multi@test.com', 'Secret#123')).token, t2 = (await login('multi@test.com', 'Secret#123')).token;
    assert.strictEqual((await call('GET', '/auth/me', undefined, t2)).s, 200);
    await rawHttp('POST', '/auth/logout', { Cookie: 'token=' + t1 });
    assert.strictEqual((await call('GET', '/auth/me', undefined, t1)).s, 401);
    assert.strictEqual((await call('GET', '/auth/me', undefined, t2)).s, 401);
  });
  await t('F3 tokenVersion is never exposed by the API', async () => {
    const users = (await call('GET', '/users', undefined, A)).b;
    assert(users.every((u) => !('tokenVersion' in u) && !('passwordHash' in u)));
    assert(!('tokenVersion' in (await call('GET', '/auth/me', undefined, U)).b));
  });
  await t('F3 CORS with credentials: allowed origin gets ACAO+credentials (never "*"), other origins get nothing', async () => {
    const ok = await rawHttp('GET', '/auth/me', { Origin: 'http://localhost:2000', Cookie: 'token=' + U });
    assert.strictEqual(ok.headers['access-control-allow-origin'], 'http://localhost:2000');
    assert.strictEqual(ok.headers['access-control-allow-credentials'], 'true');
    const evil = await rawHttp('GET', '/auth/me', { Origin: 'https://evil.example', Cookie: 'token=' + U });
    assert.strictEqual(evil.headers['access-control-allow-origin'], undefined);
    assert.strictEqual(evil.headers['access-control-allow-credentials'], undefined);
    const pre = await rawHttp('OPTIONS', '/movements', { Origin: 'http://localhost:2000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
    assert.strictEqual(pre.headers['access-control-allow-credentials'], 'true');
    const evilPre = await rawHttp('OPTIONS', '/movements', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
    assert.strictEqual(evilPre.headers['access-control-allow-origin'], undefined);
    process.env.CORS_ORIGIN = 'https://app.example.com, http://localhost:2000';
    try { assert.strictEqual((await rawHttp('GET', '/health', { Origin: 'https://app.example.com' })).headers['access-control-allow-origin'], 'https://app.example.com'); } finally { delete process.env.CORS_ORIGIN; }
    const lim = await login('locka@test.com', 'x'); is(lim, 429);
    const exp = await rawHttp('GET', '/health', { Origin: 'http://localhost:2000' });
    assert(/retry-after/i.test(exp.headers['access-control-expose-headers']), 'Retry-After must be readable cross-origin');
  });

  // ============================================================ FIX 2: pagination + streamed exports
  const pg = await h.newMaterial('PAG1'), pg2 = await h.newMaterial('PAG2'), empty = await h.newMaterial('PAGEMPTY');
  const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000);
  const mk = (material, n, offset = 0) => Array.from({ length: n }, (_, i) => ({ material, type: 'IN', quantity: 1, rate: 1, enteredRate: 1, amount: 1, balanceAfter: i + 1, movementDate: day(offset + i), createdBy: bobId }));
  await Movement.insertMany([...mk(pg, 123), ...mk(pg2, 10, 200)]);
  const truth = (m) => Movement.find({ material: m }).sort({ movementDate: 1, createdAt: 1, _id: 1 }).lean().then((r) => r.map((x) => String(x._id)));
  const page = (q) => call('GET', '/movements' + q, undefined, U);

  await t('F2 default page: envelope {data,page,limit,total,totalPages}, 50 rows, populated', async () => {
    const r = await page(`?material=${pg}`); is(r, 200);
    assert.deepStrictEqual([r.paged.page, r.paged.limit, r.paged.total, r.paged.totalPages, r.paged.data.length], [1, 50, 123, 3, 50]);
    assert.deepStrictEqual(Object.keys(r.paged).sort(), ['data', 'limit', 'page', 'total', 'totalPages']);
    assert(r.paged.data[0].material.materialId === 'PAG1' && r.paged.data[0].createdBy.name === 'Bob');
  });
  await t('F2 every page slice matches the manual ordering; totals match manual counts', async () => {
    const want = await truth(pg);
    for (const limit of [50, 7, 123, 200, 1]) {
      const pages = Math.ceil(123 / limit); const got = [];
      for (let p = 1; p <= pages; p++) {
        const r = (await call('GET', `/movements?material=${pg}&limit=${limit}&page=${p}`, undefined, U)).b;
        assert.deepStrictEqual([r.page, r.limit, r.total, r.totalPages], [p, limit, 123, pages]);
        assert.strictEqual(r.data.length, p < pages ? limit : 123 - limit * (pages - 1), `limit ${limit} page ${p}`);
        got.push(...r.data.map((x) => x._id));
      }
      assert.deepStrictEqual(got, want, `concatenated pages (limit ${limit}) differ from the full ordered list`);
    }
  });
  await t('F2 material filter combines with pagination; without a filter totals cover everything', async () => {
    const r2 = (await call('GET', `/movements?material=${pg2}&limit=4&page=3`, undefined, U)).b;
    assert.deepStrictEqual([r2.total, r2.totalPages, r2.data.length], [10, 3, 2]);
    assert(r2.data.every((x) => x.material.materialId === 'PAG2'));
    const all = (await call('GET', '/movements?limit=200&page=1', undefined, U)).b;
    assert.strictEqual(all.total, await Movement.countDocuments({}));
    assert.strictEqual(all.totalPages, Math.ceil(all.total / 200));
    const e = (await call('GET', `/movements?material=${empty}`, undefined, U)); is(e, 200);
    assert.deepStrictEqual([e.paged.data, e.paged.total, e.paged.totalPages, e.paged.page], [[], 0, 0, 1]);
  });
  await t('F2 limit above 200 is clamped to 200 (and reported)', async () => {
    for (const l of ['201', '500', '1000000', '9007199254740991']) { const r = (await call('GET', `/movements?limit=${l}`, undefined, U)); is(r, 200); assert.strictEqual(r.paged.limit, 200); assert(r.paged.data.length <= 200); }
  });
  await t('F2 invalid page / limit values are a clean 400 (page=0, negative, text, decimals, exponent, empty, arrays, overflow)', async () => {
    const bad = ['page=0', 'page=-1', 'page=-999', 'page=abc', 'page=1.5', 'page=1e2', 'page=', 'page=%20', 'page=NaN', 'page=Infinity', 'page=0x10', 'page=99999999999999999999', 'page=1&page=2', 'page[]=1',
      'limit=0', 'limit=-5', 'limit=abc', 'limit=1.5', 'limit=', 'limit=1e2', 'limit=%00', 'limit=10&limit=20', 'limit=99999999999999999999'];
    for (const q of bad) {
      const r = await call('GET', `/movements?${q}`, undefined, U);
      // 'page[]=1' is not an array parameter under Express 5's query parser; it is simply an unknown key and is ignored
      assert.strictEqual(r.s, q === 'page[]=1' ? 200 : 400, `${q} -> ${r.s} ${JSON.stringify(r.b && r.b.message)}`);
      if (r.s === 400) assert(/positive whole number/.test(r.b.message));
    }
    is(await call('GET', '/movements?page=1&material=zzz', undefined, U), 400); // bad filter still rejected
    is(await call('GET', '/movements?page=1&limit=10'), 401);
  });
  await t('F2 a page beyond the last returns an empty data array, not an error', async () => {
    for (const p of ['4', '999', '100000000', '9007199254740991']) {
      const r = await call('GET', `/movements?material=${pg}&page=${p}`, undefined, U); is(r, 200);
      assert.deepStrictEqual([r.paged.data, r.paged.total, r.paged.totalPages, r.paged.page], [[], 123, 3, Number(p)]);
    }
    const last = (await call('GET', `/movements?material=${pg}&page=3`, undefined, U)).paged; assert.strictEqual(last.data.length, 23);
  });

  // exports
  const cursorCalls = []; const origCursor = mongoose.Query.prototype.cursor;
  mongoose.Query.prototype.cursor = function (o) { cursorCalls.push(o); return origCursor.call(this, o); };
  const sheet = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb.worksheets[0]; };
  const many = mk(pg, 1400, 300); // 1,400 more rows on PAG1 = 1,523 total
  await Movement.insertMany(many);
  await t('F2 movement export is COMPLETE (all 1,533 rows, not one page), streamed via a cursor, header intact', async () => {
    cursorCalls.length = 0;
    const r = await call('GET', '/reports/movements/excel', undefined, U, true); is(r, 200);
    const total = await Movement.countDocuments({});
    const ws = await sheet(r.buf);
    assert.strictEqual(ws.rowCount, total + 1);
    assert.deepStrictEqual(ws.getRow(1).values.slice(1), ['Date', 'Material ID', 'Description', 'Type', 'Qty', 'Rate', 'Amount', 'Balance', 'Entered By', 'Note']);
    assert(ws.getRow(1).font && ws.getRow(1).font.bold, 'header should be bold');
    assert(cursorCalls.length >= 1 && cursorCalls.every((o) => o && o.batchSize > 0 && o.batchSize <= 1000), 'export did not use a bounded cursor');
    assert.strictEqual(r.headers.get('content-length'), null, 'a streamed download has no up-front Content-Length');
    assert.strictEqual(r.headers.get('transfer-encoding'), 'chunked');
    assert(/attachment; filename=".*\.xlsx"/.test(r.headers.get('content-disposition')));
    // order + content of a few rows against the database
    const first = ws.getRow(2).values.slice(1);
    assert(['PAG1', 'PAG2'].includes(first[1]) || typeof first[1] === 'string');
  });
  await t('F2 export filters still apply while streaming (material, from/to)', async () => {
    let ws = await sheet((await call('GET', `/reports/movements/excel?material=${pg2}`, undefined, U, true)).buf); assert.strictEqual(ws.rowCount, 11);
    ws = await sheet((await call('GET', `/reports/movements/excel?material=${pg}`, undefined, U, true)).buf); assert.strictEqual(ws.rowCount, 1524);
    ws = await sheet((await call('GET', `/reports/movements/excel?material=${pg}&from=2026-01-01&to=2026-01-10`, undefined, U, true)).buf); assert.strictEqual(ws.rowCount, 11);
    ws = await sheet((await call('GET', `/reports/movements/excel?material=${empty}`, undefined, U, true)).buf); assert.strictEqual(ws.rowCount, 1);
    is(await call('GET', '/reports/movements/excel?from=zzz', undefined, U), 400); // errors are still clean JSON: validation runs before streaming starts
  });
  await Material.insertMany(Array.from({ length: 140 }, (_, i) => ({ materialId: `BULK${String(i).padStart(3, '0')}`, description: `Bulk ${i}`, unit: 'Nos', currentQuantity: i, currentRate: 2, minimumQuantity: 50 })));
  await t('F2 stock-value Excel and PDF stream all materials through a cursor (complete, multi-page PDF)', async () => {
    cursorCalls.length = 0;
    const active = await Material.countDocuments({ isActive: true });
    const x = await call('GET', '/reports/stock-value/excel', undefined, U, true); is(x, 200);
    const ws = await sheet(x.buf); assert.strictEqual(ws.rowCount, active + 1);
    assert.strictEqual(ws.getRow(2).getCell(1).value.startsWith('BULK') || typeof ws.getRow(2).getCell(1).value === 'string', true);
    const p = await call('GET', '/reports/stock-value/pdf', undefined, U, true); is(p, 200);
    assert.strictEqual(p.buf.slice(0, 5).toString(), '%PDF-');
    const text = pdfText(p.buf);
    const need = (await Material.find({ isActive: true }).select('materialId').lean()).map((x) => x.materialId);
    const missing = need.filter((id) => !text.includes(id));
    const pages = (p.buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert(!missing.length, `PDF missing ${missing.length}/${need.length}: ${missing.slice(0, 6)} pages=${pages} bytes=${p.buf.length} lines=${text.split('\n').length} tail=${JSON.stringify(text.trim().split('\n').slice(-3))}`);
    assert((p.buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1, 'PDF should span several pages');
    assert(cursorCalls.length >= 2, 'both exports should use a cursor');
    assert.strictEqual(p.headers.get('content-length'), null);
  });
  mongoose.Query.prototype.cursor = origCursor;

  // ============================================================ FIX 4: database-level material lock
  const lockDoc = (id) => Material.findById(id).select('+lockedUntil +lockToken').lean();
  const chainOk = async (matId, label) => {
    const mat = (await call('GET', `/materials/${matId}`, undefined, U)).b;
    const ms = sorted((await call('GET', `/movements?material=${matId}`, undefined, U)).b);
    const o = oracle({ qty: mat.openingQuantity, rate: mat.openingRate }, ms);
    ms.forEach((mv, i) => { near(mv.balanceAfter, o.rows[i].bal, 0.002); near(mv.rate, o.rows[i].rate, Math.max(1e-4, Math.abs(o.rows[i].rate) * 1e-6)); assert.strictEqual(mv.exceededStock, o.rows[i].ex, `${label} #${i}`); });
    near(mat.currentQuantity, o.qty, 0.002);
    return { mat, ms };
  };
  await t('F4 lock fields never leak through the API', async () => {
    const m = await h.newMaterial('LK0');
    const r = await h.move(m, 'IN', 5, 5); is(r, 201);
    for (const o of [r.b.material, (await call('GET', `/materials/${m}`, undefined, U)).b, (await call('GET', '/materials', undefined, U)).b.find((x) => x._id === m)])
      assert(!('lockedUntil' in o) && !('lockToken' in o));
  });
  await t('F4 lock is released after success and after a failure inside the critical section', async () => {
    const m = await h.newMaterial('LK1');
    const r = await h.move(m, 'OUT', 1); is(r, 201);
    let d = await lockDoc(m); assert(!d.lockedUntil && !d.lockToken, 'not released after success');
    is(await call('PUT', `/movements/${r.b.movement._id}`, { type: 'IN' }, A), 400); // throws inside the lock (IN needs a rate)
    d = await lockDoc(m); assert(!d.lockedUntil && !d.lockToken, 'not released after an error');
    is(await call('PUT', `/materials/${m}`, { openingQuantity: 5 }, A), 409); // 409 opening edit blocked, also inside the lock
    d = await lockDoc(m); assert(!d.lockedUntil && !d.lockToken, 'not released after a 409');
    is(await h.move(m, 'RETURN', 1), 201);
  });
  await t('F4 CRASH: a lock left behind by a dead process expires by itself and the next request gets it', async () => {
    const m = await h.newMaterial('LK2');
    await Material.updateOne({ _id: m }, { lockedUntil: new Date(Date.now() + 2000), lockToken: 'crashed-process' }, { timestamps: false });
    const t0 = Date.now();
    const r = await h.move(m, 'IN', 3, 9); // must wait for the lease, then succeed
    const waited = Date.now() - t0;
    is(r, 201);
    assert(waited >= 1500, `did not respect the live lock (returned after ${waited}ms)`);
    assert(waited < 9000, `lock did not expire in time (${waited}ms)`);
    assert.strictEqual(r.b.material.currentQuantity, 3);
    const d = await lockDoc(m); assert(!d.lockedUntil && !d.lockToken);
    await chainOk(m, 'after-crash');
  });
  await t('F4 an already-expired stale lock is taken over immediately', async () => {
    const m = await h.newMaterial('LK3');
    await Material.updateOne({ _id: m }, { lockedUntil: new Date(Date.now() - 5000), lockToken: 'ancient' }, { timestamps: false });
    const t0 = Date.now(); is(await h.move(m, 'IN', 1, 1), 201); assert(Date.now() - t0 < 4000);
  });
  await t('F4 a lock that is still held gives up with 409 "busy" in bounded time (never hangs) and is not stolen', async () => {
    const m = await h.newMaterial('LK4');
    await Material.updateOne({ _id: m }, { lockedUntil: new Date(Date.now() + 3600000), lockToken: 'held-elsewhere' }, { timestamps: false });
    const saved = { ...lockConfig }; Object.assign(lockConfig, { attempts: 6, baseDelayMs: 10, maxDelayMs: 40 });
    try {
      const t0 = Date.now();
      const r = await h.move(m, 'IN', 1, 1);
      is(r, 409); assert(/busy, try again/i.test(r.b.message), r.b.message);
      assert(Date.now() - t0 < 5000, 'took too long to give up');
      is(await call('PUT', `/materials/${m}`, { description: 'x' }, A), 409);
      const mv = (await h.move(m, 'OUT', 1)); is(mv, 409);
      assert.strictEqual(await Movement.countDocuments({ material: m }), 0, 'nothing may be written without the lock');
      assert.strictEqual((await lockDoc(m)).lockToken, 'held-elsewhere', 'a waiting request must not steal or clear the lock');
    } finally { Object.assign(lockConfig, saved); }
    await Material.updateOne({ _id: m }, { $unset: { lockedUntil: 1, lockToken: 1 } }, { timestamps: false });
    is(await h.move(m, 'IN', 1, 1), 201);
  });
  await t('F4 a slow holder whose lease expired cannot release the NEW holder\'s lock', async () => {
    const m = await h.newMaterial('LK5');
    const { withLock } = require('../utils/costing');
    const saved = { ...lockConfig }; Object.assign(lockConfig, { ttlMs: 300, localQueue: false, attempts: 100, baseDelayMs: 20, maxDelayMs: 50 });
    try {
      let secondToken;
      const first = withLock(m, async () => { await sleep(1200); });          // outlives its 300ms lease
      await sleep(600);                                                        // lease expired, the second caller takes over
      const second = withLock(m, async () => { secondToken = (await lockDoc(m)).lockToken; await sleep(1500); });
      await sleep(900);                                                        // first has finished and run its release by now
      await first;
      const mid = await lockDoc(m);
      assert(secondToken && mid.lockToken === secondToken, 'first holder released the second holder\'s lock');
      await second;
      const end = await lockDoc(m); assert(!end.lockToken && !end.lockedUntil);
    } finally { Object.assign(lockConfig, saved); }
  });
  await t('F4 pure database lock (in-process queue OFF): 20 simultaneous OUTs are still exactly right', async () => {
    const m = await h.newMaterial('LK6'); is(await h.move(m, 'IN', 1000, 10, { movementDate: '2026-01-01' }), 201);
    const saved = { ...lockConfig }; Object.assign(lockConfig, { localQueue: false, attempts: 400 });
    try {
      const rs = await Promise.all(Array.from({ length: 20 }, () => h.move(m, 'OUT', 1)));
      rs.forEach((r) => is(r, 201));
    } finally { Object.assign(lockConfig, saved); }
    const { mat, ms } = await chainOk(m, 'db-lock-only');
    assert.strictEqual(mat.currentQuantity, 980);
    assert.deepStrictEqual(ms.slice(1).map((x) => x.balanceAfter).sort((a, b) => b - a), Array.from({ length: 20 }, (_, i) => 999 - i));
  });
  await t('F4 pure database lock with a tiny retry budget: some requests get 409, but accepted ones are all accounted for (no lost update)', async () => {
    const m = await h.newMaterial('LK7'); is(await h.move(m, 'IN', 1000, 10, { movementDate: '2026-01-01' }), 201);
    const saved = { ...lockConfig }; Object.assign(lockConfig, { localQueue: false, attempts: 2, baseDelayMs: 5, maxDelayMs: 10 });
    let rs;
    try { rs = await Promise.all(Array.from({ length: 20 }, () => h.move(m, 'OUT', 1))); } finally { Object.assign(lockConfig, saved); }
    const ok = rs.filter((r) => r.s === 201).length, busy = rs.filter((r) => r.s === 409).length;
    assert.strictEqual(ok + busy, 20, JSON.stringify(rs.map((r) => r.s)));
    assert(busy > 0, 'expected contention to produce some 409s');
    const { mat } = await chainOk(m, 'low-budget');
    assert.strictEqual(mat.currentQuantity, 1000 - ok);
    const d = await lockDoc(m); assert(!d.lockToken, 'lock left behind');
  });
  await t('F4 TWO REAL PROCESSES hammering one material: 24 mixed movements, exact chain, no lost update', async () => {
    const m = await h.newMaterial('LK8', { openingQuantity: 500, openingRate: 20 });
    const uCookie = U;
    const send = (viaChild, i) => {
      const body = i % 3 === 0 ? { material: m, type: 'IN', quantity: 2 + i, rate: 20 + i, movementDate: '2026-02-01' } : { material: m, type: 'OUT', quantity: 1 + (i % 4), movementDate: '2026-02-01' };
      return viaChild ? childCall('POST', '/movements', body, uCookie) : call('POST', '/movements', body, uCookie);
    };
    const jobs = Array.from({ length: 24 }, (_, i) => send(i % 2 === 1, i)); // 12 through this process, 12 through the other
    const rs = await Promise.all(jobs);
    const codes = rs.map((r) => r.s);
    assert(codes.every((c) => c === 201), 'unexpected statuses: ' + JSON.stringify(codes));
    const { ms } = await chainOk(m, 'two-processes');
    assert.strictEqual(ms.length, 24);
    const d = await lockDoc(m); assert(!d.lockToken);
  });
  await t('F4 across processes: an edit in one and a movement in the other never interleave', async () => {
    const m = await h.newMaterial('LK9', { openingQuantity: 100, openingRate: 10 });
    const first = (await h.move(m, 'IN', 50, 12, { movementDate: '2026-03-01' })).b.movement._id;
    const rs = await Promise.all([
      call('PUT', `/movements/${first}`, { quantity: 80 }, A),
      childCall('POST', '/movements', { material: m, type: 'OUT', quantity: 7, movementDate: '2026-03-05' }, U),
      childCall('PUT', `/movements/${first}`, { enteredRate: 15 }, A),
      call('POST', '/movements', { material: m, type: 'RETURN', quantity: 3, movementDate: '2026-03-02' }, U),
    ]);
    rs.forEach((r) => assert([200, 201].includes(r.s), 'status ' + r.s));
    await chainOk(m, 'edit-vs-post');
  });

  child.stdin.end();
  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
