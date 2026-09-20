// Full end-to-end scenario over real HTTP, from signup to report downloads.
const ExcelJS = require('exceljs');
const pdfText = require('./pdfText');
const setup = require('./harness');

const sheet = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb.worksheets[0]; };

(async () => {
  const h = await setup('e2e');
  const { t, is, call, assert, near } = h;
  const email = 'newbie@test.com', password = 'BrandNew#1';
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
  let fin; // final material state after the correction
  await t('8. admin corrects FIRST movement qty 50->100: original frozen, reversal+corrected posted, ledger matches oracle', async () => {
    const { oracle, sorted } = require('./oracle');
    const r = await call('PUT', `/movements/${first}`, { quantity: 100 }, A); is(r, 200);
    assert.strictEqual(r.b.original.quantity, 50); assert.strictEqual(r.b.original.amount, 22500); assert(r.b.original.isEdited === true);
    const l = (await call('GET', `/movements?material=${mat}`, undefined, U)).b;
    assert.strictEqual(l.length, 4);
    const raw = l.map((x) => ({ ...x, _id: String(x._id) }));
    const o = oracle({ qty: 100, rate: 400 }, sorted(raw));
    const ord = sorted(raw);
    assert.deepStrictEqual(ord.map((x) => x.type + x.quantity), ['IN50', 'OUT30', 'OUT50', 'IN100']);
    assert(ord[2].isReversal && String(ord[2].correctionOf) === first && ord[3].correctionOf && !ord[3].isReversal);
    ord.forEach((x, i) => { near(x.balanceAfter, o.rows[i].bal, 1e-6); near(x.rate, o.rows[i].rate, 0.01); near(x.amount, o.rows[i].amount, 0.01); });
    const d = (await call('GET', '/reports/dashboard', undefined, U)).b;
    const m = d.materials.find((x) => x.materialId === 'CEM1');
    assert.strictEqual(m.currentQuantity, 170); near(m.currentRate, o.rate, 1e-6); near(m.stockValue, 170 * o.rate, 0.01);
    near(d.totalStockValue, 170 * o.rate, 0.01);
    fin = { rate: o.rate, value: 170 * o.rate };
  });
  await t('8b. an original can be corrected only once', async () => is(await call('PUT', `/movements/${first}`, { quantity: 1 }, A), 400));
  await t('9a. stock-value Excel: non-empty, right data', async () => {
    const r = await call('GET', '/reports/stock-value/excel', undefined, U, true); is(r, 200);
    assert(r.buf.length > 500 && r.buf.slice(0, 2).toString() === 'PK');
    assert(/filename=".*\.xlsx"/.test(r.headers.get('content-disposition')));
    const ws = await sheet(r.buf);
    const v = ws.getRow(2).values.slice(1);
    assert.deepStrictEqual([v[0], v[1], v[2], v[3], v[6]], ['CEM1', 'Cement', 'Bag', 170, 'Available']);
    near(v[4], fin.rate, 0.01); near(v[5], fin.value, 0.01);
  });
  await t('9b. stock-value PDF: non-empty, right data', async () => {
    const r = await call('GET', '/reports/stock-value/pdf', undefined, U, true);
    is(r, 200);
    assert(r.buf.length > 1000 && r.buf.slice(0, 5).toString() === '%PDF-');
    const text = pdfText(r.buf);
    for (const w of ['CEM1', 'Cement', fin.value.toFixed(2), fin.rate.toFixed(2)]) assert(text.includes(w), 'missing ' + w);
  });
  await t('9c. movement-history Excel: non-empty, right data (all 4 rows incl. reversal + corrected)', async () => {
    const r = await call('GET', '/reports/movements/excel', undefined, U, true); is(r, 200);
    const ws = await sheet(r.buf);
    assert.strictEqual(ws.rowCount, 5);
    const rows = [2, 3, 4, 5].map((i) => ws.getRow(i).values.slice(1));
    assert.deepStrictEqual(rows.map((x) => x.slice(1, 5)), [['CEM1', 'Cement', 'IN', 50], ['CEM1', 'Cement', 'OUT', 30], ['CEM1', 'Cement', 'OUT', 50], ['CEM1', 'Cement', 'IN', 100]]);
    assert.deepStrictEqual([rows[0][5], rows[0][6], rows[0][7], rows[0][8]], [450, 22500, 150, 'New Bie']);
    assert.strictEqual(rows[3][5], 450); assert.strictEqual(rows[3][6], 45000); assert.strictEqual(rows[3][7], 170);
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
