// Full end-to-end scenario over real HTTP, from signup to report downloads.
const ExcelJS = require('exceljs');
const pdfText = require('./pdfText');
const setup = require('./harness');

const sheet = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb.worksheets[0]; };

(async () => {
  const h = await setup('e2e');
  const { t, is, call, assert, near } = h;
  const email = 'newbie@test.com', password = 'brandnew1';
  let uid, U, mat, first, second;
  const A = h.admin;

  await t('1. sign up a brand new user (pending)', async () => {
    const r = await call('POST', '/auth/signup', { name: 'New Bie', email, password });
    is(r, 201); assert.strictEqual(r.b.status, 'pending'); uid = r.b.id;
    is(await call('POST', '/auth/login', { email, password }), 403);
  });
  await t('2. admin approves', async () => is(await call('PATCH', `/users/${uid}/approve`, undefined, A), 200));
  await t('3. new user cannot create a material (403)', async () => {
    const l = await call('POST', '/auth/login', { email, password }); is(l, 200); U = l.token;
    const r = await call('POST', '/materials', { materialId: 'CEM1', description: 'Cement', unit: 'Bag' }, U);
    is(r, 403);
  });
  await t('4. admin creates material, opening 100 @ 400', async () => {
    const r = await call('POST', '/materials', { materialId: 'CEM1', description: 'Cement', unit: 'Bag', openingQuantity: 100, openingRate: 400, minimumQuantity: 50 }, A);
    is(r, 201); mat = r.b._id;
    assert(r.b.currentQuantity === 100 && r.b.currentRate === 400);
  });
  await t('5. user records IN 50 @ 450', async () => {
    const r = await call('POST', '/movements', { material: mat, type: 'IN', quantity: 50, rate: 450 }, U);
    is(r, 201); first = r.b.movement._id;
    assert.strictEqual(r.b.movement.amount, 22500);
    assert.strictEqual(r.b.material.currentQuantity, 150);
    near(r.b.material.currentRate, 416.6667, 0.0001);
  });
  await t('6. user records OUT 30', async () => {
    const r = await call('POST', '/movements', { material: mat, type: 'OUT', quantity: 30 }, U);
    is(r, 201); second = r.b.movement._id;
    assert.strictEqual(r.b.material.currentQuantity, 120);
    near(r.b.movement.amount, 30 * 416.6667, 0.01);
    assert(!r.b.warning);
  });
  await t('7. dashboard: qty 120, rate 416.67, value 50000', async () => {
    const d = (await call('GET', '/reports/dashboard', undefined, U)).b;
    const m = d.materials.find((x) => x.materialId === 'CEM1');
    assert.strictEqual(m.currentQuantity, 120);
    near(m.currentRate, 416.6667, 0.0001);
    near(m.stockValue, 50000, 0.01);
    assert.strictEqual(m.status, 'AVAILABLE');
    near(d.totalStockValue, 50000, 0.01);
  });
  await t('8. admin edits FIRST movement qty 50->100: ledger + dashboard recalc', async () => {
    const r = await call('PUT', `/movements/${first}`, { quantity: 100 }, A); is(r, 200);
    // (100*400 + 100*450) / 200 = 425 ; OUT 30 -> 170
    const l = (await call('GET', `/movements?material=${mat}`, undefined, U)).b;
    assert.deepStrictEqual(l.map((x) => x.balanceAfter), [200, 170]);
    assert(l[0].amount === 45000 && l[0].isEdited === true && l[0].rate === 450);
    assert(l[1].rate === 425 && l[1].amount === 12750);
    const d = (await call('GET', '/reports/dashboard', undefined, U)).b;
    const m = d.materials.find((x) => x.materialId === 'CEM1');
    assert(m.currentQuantity === 170 && m.currentRate === 425 && m.stockValue === 72250);
    assert.strictEqual(d.totalStockValue, 72250);
  });
  await t('9a. stock-value Excel: non-empty, right data', async () => {
    const r = await call('GET', '/reports/stock-value/excel', undefined, U, true); is(r, 200);
    assert(r.buf.length > 500 && r.buf.slice(0, 2).toString() === 'PK');
    assert(/filename=".*\.xlsx"/.test(r.headers.get('content-disposition')));
    const ws = await sheet(r.buf);
    assert.deepStrictEqual(ws.getRow(2).values.slice(1), ['CEM1', 'Cement', 'Bag', 170, 425, 72250, 'Available']);
  });
  await t('9b. stock-value PDF: non-empty, right data', async () => {
    const r = await call('GET', '/reports/stock-value/pdf', undefined, U, true);
    is(r, 200);
    assert(r.buf.length > 1000 && r.buf.slice(0, 5).toString() === '%PDF-');
    const text = pdfText(r.buf);
    for (const w of ['CEM1', 'Cement', '72250.00', '425.00']) assert(text.includes(w), 'missing ' + w);
  });
  await t('9c. movement-history Excel: non-empty, right data', async () => {
    const r = await call('GET', '/reports/movements/excel', undefined, U, true); is(r, 200);
    const ws = await sheet(r.buf);
    assert.strictEqual(ws.rowCount, 3);
    const r1 = ws.getRow(2).values.slice(1), r2 = ws.getRow(3).values.slice(1);
    assert.deepStrictEqual(r1.slice(1, 9), ['CEM1', 'Cement', 'IN', 100, 450, 45000, 200, 'New Bie']);
    assert.deepStrictEqual(r2.slice(1, 9), ['CEM1', 'Cement', 'OUT', 30, 425, 12750, 170, 'New Bie']);
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
