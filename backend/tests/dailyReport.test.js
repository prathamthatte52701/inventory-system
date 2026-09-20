// Daily per-material summary report (GET /reports/daily-summary?date=YYYY-MM-DD)
const ExcelJS = require('exceljs');
const setup = require('./harness');

(async () => {
  const h = await setup('dailyReport');
  const { t, is, call, assert } = h;
  const get = (d, tok = h.user) => call('GET', '/reports/daily-summary' + (d === undefined ? '' : `?date=${d}`), undefined, tok || undefined, true);
  const rows = async (d, tok) => {
    const r = await get(d, tok); is(r, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf);
    const ws = wb.worksheets[0];
    const by = {}; ws.eachRow((row, i) => { if (i > 1) by[row.getCell(1).value] = row.values.slice(1); });
    return { by, header: ws.getRow(1).values.slice(1), r };
  };

  const a = await h.newMaterial('DA1', { description: 'Alpha', unit: 'Nos', minimumQuantity: 50, openingQuantity: 10, openingRate: 5 });
  const b = await h.newMaterial('DB1', { description: 'Beta', unit: 'Nos', minimumQuantity: 5 });
  const c = await h.newMaterial('DC1', { description: 'Gamma', unit: 'Nos', minimumQuantity: 5 });
  const gone = await h.newMaterial('DD1', { description: 'Retired', unit: 'Nos' });
  await h.move(gone, 'IN', 5, 1, { movementDate: '2026-05-10' });
  await call('PATCH', `/materials/${gone}/deactivate`, undefined, h.admin);

  await h.move(a, 'IN', 100, 10, { movementDate: '2026-05-09' });   // 110
  await h.move(a, 'IN', 40, 20, { movementDate: '2026-05-10T08:00:00Z' });
  await h.move(a, 'IN', 10, 30, { movementDate: '2026-05-10T09:00:00Z' });
  await h.move(a, 'OUT', 60, undefined, { movementDate: '2026-05-10T15:00:00Z' }); // 100
  await h.move(b, 'IN', 20, 1, { movementDate: '2026-05-01' });    // history only
  await h.move(c, 'IN', 10, 1, { movementDate: '2026-05-10' });
  await h.move(c, 'OUT', 10, undefined, { movementDate: '2026-05-10T12:00:00Z' }); // 0

  await t('columns and summed day', async () => {
    const { by, header } = await rows('2026-05-10');
    assert.deepStrictEqual(header, ['EDP No', 'Size', 'Rate', 'Opening', 'Receipt', 'Issue', 'Balance', 'Status']);
    assert.strictEqual(by.DA1[0], 'DA1'); assert.strictEqual(by.DA1[1], 'Alpha');
    assert.deepStrictEqual(by.DA1.slice(3), [110, 50, 60, 100, 'Available']);
    // avg after 110@(10*5+100*10)/110, +40@20, +10@30
    const r1 = (10 * 5 + 100 * 10) / 110, r2 = (110 * r1 + 40 * 20) / 150, r3 = (150 * r2 + 10 * 30) / 160;
    h.near(by.DA1[2], r3, 0.001);
  });
  await t('no movement that day: opening = balance, zeros', async () => {
    const { by } = await rows('2026-05-10');
    assert.deepStrictEqual(by.DB1.slice(3), [20, 0, 0, 20, 'Available']);
    assert.deepStrictEqual(by.DC1.slice(3), [0, 10, 10, 0, 'Out of Stock']);
  });
  await t('inactive excluded', async () => { assert.strictEqual((await rows('2026-05-10')).by.DD1, undefined); });
  await t('date with no movements anywhere returns every active material', async () => {
    const { by } = await rows('2026-06-30');
    assert.deepStrictEqual(Object.keys(by).sort(), ['DA1', 'DB1', 'DC1']);
    assert.deepStrictEqual(by.DA1.slice(3), [100, 0, 0, 100, 'Available']);
  });
  await t('date before any movement = opening quantity', async () => {
    const { by } = await rows('2020-01-01');
    assert.deepStrictEqual(by.DA1.slice(3), [10, 0, 0, 10, 'Low Stock']);
    assert.strictEqual(by.DA1[2], 5);
    assert.deepStrictEqual(by.DB1.slice(3), [0, 0, 0, 0, 'Out of Stock']);
  });
  await t('back-dated movement entered later is reflected', async () => {
    is(await h.move(b, 'IN', 7, 1, { movementDate: '2026-05-05' }), 201);
    const { by } = await rows('2026-05-05');
    assert.deepStrictEqual(by.DB1.slice(3), [20, 7, 0, 27, 'Available']);
    assert.strictEqual((await rows('2026-05-10')).by.DB1[6], 27);
  });
  await t('RETURN changes balance, not Receipt/Issue', async () => {
    is(await h.move(b, 'RETURN', 3, undefined, { movementDate: '2026-05-20' }), 201);
    const { by } = await rows('2026-05-20');
    assert.deepStrictEqual(by.DB1.slice(3), [27, 0, 0, 30, 'Available']);
  });
  await t('invalid or missing date -> 400 JSON', async () => {
    for (const d of [undefined, '', '2026-02-30', '2026-13-01', '10-05-2026', '2026-5-1', 'abc', '2026-05-10T00:00:00Z']) {
      const r = await call('GET', '/reports/daily-summary' + (d === undefined ? '' : `?date=${encodeURIComponent(d)}`), undefined, h.user); is(r, 400);
      assert(r.b.message);
    }
  });
  await t('unauthenticated -> 401; normal user 200; filename', async () => {
    is(await get('2026-05-10', null), 401);
    const { r } = await rows('2026-05-10', h.user);
    assert(/daily-summary-2026-05-10\.xlsx/.test(r.headers.get('content-disposition')));
  });

  await h.finish();
})();
