// Role toggle endpoint (added for the Users admin page)
const setup = require('./harness');

(async () => {
  const h = await setup('roles');
  const { t, is, call, assert, mongoose } = h;
  const bob = (await h.User.findOne({ email: 'bob@test.com' }))._id;
  const admin = (await h.User.findOne({ role: 'admin' }))._id;

  await t('admin promotes user -> new admin powers immediately', async () => {
    const r = await call('PATCH', `/users/${bob}/role`, { role: 'admin' }, h.admin);
    is(r, 200); assert.strictEqual(r.b.role, 'admin');
    is(await call('GET', '/users', undefined, h.user), 200); // same token, role read from DB
  });
  await t('admin demotes again', async () => {
    const r = await call('PATCH', `/users/${bob}/role`, { role: 'user' }, h.admin);
    is(r, 200); assert.strictEqual(r.b.role, 'user');
    is(await call('GET', '/users', undefined, h.user), 403);
  });
  await t('non-admin 403, no token 401', async () => {
    is(await call('PATCH', `/users/${admin}/role`, { role: 'user' }, h.user), 403);
    is(await call('PATCH', `/users/${bob}/role`, { role: 'admin' }), 401);
  });
  await t('cannot change own role', async () => is(await call('PATCH', `/users/${admin}/role`, { role: 'user' }, h.admin), 400));
  await t('bad role 400, missing 400', async () => {
    is(await call('PATCH', `/users/${bob}/role`, { role: 'root' }, h.admin), 400);
    is(await call('PATCH', `/users/${bob}/role`, {}, h.admin), 400);
  });
  await t('unknown id 404, malformed id 400', async () => {
    is(await call('PATCH', `/users/${new mongoose.Types.ObjectId()}/role`, { role: 'admin' }, h.admin), 404);
    is(await call('PATCH', '/users/xyz/role', { role: 'admin' }, h.admin), 400);
  });
  await t('audited', async () => assert(await mongoose.models.AuditLog.exists({ action: 'USER_ROLE_CHANGE' })));

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
