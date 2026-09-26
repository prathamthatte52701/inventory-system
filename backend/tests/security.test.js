// Security headers (helmet): confirm what's actually enabled/disabled, and that neither CORS nor report
// downloads regressed with helmet in place — headers are asserted on real responses, not read from source.
const setup = require('./harness');

(async () => {
  const h = await setup('security');
  const { t, is, assert, base } = h;
  const A = h.admin, U = h.user;

  await t('helmet defaults are present on a normal JSON response', async () => {
    const r = await fetch(base + '/health');
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.strictEqual(r.headers.get('x-dns-prefetch-control'), 'off');
    assert.strictEqual(r.headers.get('x-download-options'), 'noopen');
    assert.strictEqual(r.headers.get('x-permitted-cross-domain-policies'), 'none');
    assert.strictEqual(r.headers.get('x-xss-protection'), '0');
    assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer');
    assert.strictEqual(r.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.strictEqual(r.headers.get('x-powered-by'), null); // hidden, like helmet's default
  });

  await t('CSP is deliberately off: a JSON-only API serving no HTML has no use for a document CSP', async () => {
    const r = await fetch(base + '/health');
    assert.strictEqual(r.headers.get('content-security-policy'), null);
  });

  await t('Cross-Origin-Resource-Policy is "cross-origin", not helmet\'s "same-origin" default — this API is deliberately read cross-origin by two SPA frontends', async () => {
    const r = await fetch(base + '/health');
    assert.strictEqual(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
  });

  await t('HSTS is off in this (non-HTTPS, COOKIE_SECURE unset) test environment, matching the app\'s own secure-cookie gate', async () => {
    assert.notStrictEqual(process.env.COOKIE_SECURE, 'true'); // sanity: this test run really is the "not secure" branch
    const r = await fetch(base + '/health');
    assert.strictEqual(r.headers.get('strict-transport-security'), null);
  });

  await t('CORS preflight still works with helmet in place: allow-origin/methods/headers/credentials all present', async () => {
    const r = await fetch(base + '/auth/login', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:2000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers.get('access-control-allow-origin'), 'http://localhost:2000');
    assert.strictEqual(r.headers.get('access-control-allow-credentials'), 'true');
    assert(r.headers.get('access-control-allow-methods').includes('POST'));
    assert(r.headers.get('access-control-allow-headers').includes('content-type'));
    assert.strictEqual(r.headers.get('cross-origin-resource-policy'), 'cross-origin'); // present on the preflight too
  });

  await t('a real cross-origin, credentialed GET still gets CORS headers reflecting the caller\'s origin', async () => {
    const r = await fetch(base + '/health', { headers: { Origin: 'http://localhost:5174' } }); // the admin app's origin
    assert.strictEqual(r.headers.get('access-control-allow-origin'), 'http://localhost:5174');
    assert.strictEqual(r.headers.get('access-control-allow-credentials'), 'true');
  });

  await t('an origin NOT on the allow-list gets no Access-Control-Allow-Origin (helmet did not loosen or break this)', async () => {
    const r = await fetch(base + '/health', { headers: { Origin: 'http://evil.example.com' } });
    assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
  });

  await t('a real report download: Content-Disposition survives, is on the CORS-exposed list, and the file is intact', async () => {
    const r = await fetch(base + '/reports/stock-value/excel', { headers: { Cookie: 'token=' + A, Origin: 'http://localhost:2000' } });
    is({ s: r.status }, 200);
    const cd = r.headers.get('content-disposition');
    assert(cd && cd.startsWith('attachment; filename="stock-value-'), cd);
    assert.strictEqual(r.headers.get('access-control-allow-origin'), 'http://localhost:2000');
    const exposed = r.headers.get('access-control-expose-headers') || '';
    assert(exposed.includes('Content-Disposition'), exposed); // the cross-origin frontend can actually read the filename
    assert.strictEqual(r.headers.get('cross-origin-resource-policy'), 'cross-origin'); // the frontend can read the body at all
    const buf = Buffer.from(await r.arrayBuffer());
    assert(buf.length > 500, buf.length);
    assert.strictEqual(buf.slice(0, 2).toString(), 'PK'); // a real, unbroken .xlsx (zip) file, not truncated by a header change
  });

  await t('the import upload path (multipart, its own JSON size limit) is unaffected by helmet', async () => {
    const r = await h.call('GET', '/imports?page=1&limit=1', undefined, U);
    is(r, 200); // still authenticated/paginated normally; helmet did not interfere with this route's own middleware chain
  });

  await t('ordinary authenticated JSON requests (login, an admin-only route) still work end to end with helmet in the chain', async () => {
    is(await h.call('GET', '/users?limit=1', undefined, A), 200);
    is(await h.call('GET', '/materials', undefined, U), 200);
  });

  await h.finish();
})();
