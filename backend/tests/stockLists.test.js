// Low Stock and Out of Stock exports: same row shape as Stock Value, filtered server-side.
const ExcelJS = require('exceljs');
const setup = require('./harness');

(async () => {
  const h = await setup('stockLists');
  const { t, is, call, assert } = h;
  const get = (path, tok = h.user) => call('GET', path, undefined, tok || undefined, true);
  const sheet = async (path) => {
    const r = await get(path); is(r, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf);
    const ws = wb.worksheets[0];
    const ids = []; ws.eachRow((row, i) => { if (i > 1) ids.push(row.getCell(1).value); });
    return { r, ids, header: ws.getRow(1).values.slice(1), ws };
  };
  const LOW = '/reports/stock/low-stock/excel', OUT = '/reports/stock/out-of-stock/excel';

  // (id, opening qty, minimum): AVAIL 100/10, LOW 5/10, EDGE 10/10 (exactly at minimum), ZERO 0/10, ZEROMIN 0/0, ONE 1/0
  const mk = (id, q, min) => h.newMaterial(id, { unit: 'Nos', openingQuantity: q, openingRate: 2, minimumQuantity: min });
  await mk('AVAIL', 100, 10); await mk('LOW', 5, 10); await mk('EDGE', 10, 10);
  await mk('ZERO', 0, 10); await mk('ZEROMIN', 0, 0); await mk('ONE', 1, 0);
  const gone = await mk('GONELOW', 3, 10);
  const goneZero = await mk('GONEZERO', 0, 10);
  await call('PATCH', `/materials/${gone}/deactivate`, undefined, h.admin);
  await call('PATCH', `/materials/${goneZero}/deactivate`, undefined, h.admin);

  await t('Low Stock: only 0 < qty <= minimum; a material exactly at its minimum is LOW; no zero, available or inactive rows', async () => {
    const { ids } = await sheet(LOW);
    assert.deepStrictEqual(ids, ['EDGE', 'LOW']);
  });

  await t('Out of Stock: only qty <= 0; no low, available or inactive rows', async () => {
    const { ids } = await sheet(OUT);
    assert.deepStrictEqual(ids, ['ZERO', 'ZEROMIN']);
  });

  await t('boundaries agree with the Material status virtual, material by material', async () => {
    const all = (await call('GET', '/materials', undefined, h.user)).b.filter((m) => m.isActive);
    const low = (await sheet(LOW)).ids, out = (await sheet(OUT)).ids;
    for (const m of all) {
      assert.strictEqual(low.includes(m.materialId), m.status === 'LOW_STOCK', m.materialId + ' low');
      assert.strictEqual(out.includes(m.materialId), m.status === 'OUT_OF_STOCK', m.materialId + ' out');
    }
  });

  await t('same columns and row shape as Stock Value; Status column matches the list', async () => {
    const sv = await sheet('/reports/stock-value/excel');
    const low = await sheet(LOW), out = await sheet(OUT);
    assert.deepStrictEqual(low.header, sv.header); assert.deepStrictEqual(out.header, sv.header);
    assert.deepStrictEqual(low.header, ['Material ID', 'Description', 'Unit', 'Current Qty', 'Rate', 'Stock Value', 'Status']);
    low.ws.eachRow((row, i) => { if (i > 1) assert.strictEqual(row.getCell(7).value, 'Low Stock'); });
    out.ws.eachRow((row, i) => { if (i > 1) assert.strictEqual(row.getCell(7).value, 'Out of Stock'); });
    assert(sv.ids.includes('AVAIL'));
  });

  await t('filenames carry the date and download headers are right', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const a = await get(LOW), b = await get(OUT);
    assert.match(a.headers.get('content-disposition'), new RegExp(`low-stock-${day}\\.xlsx`));
    assert.match(b.headers.get('content-disposition'), new RegExp(`out-of-stock-${day}\\.xlsx`));
    assert.match(a.headers.get('content-type'), /spreadsheetml/);
  });

  await t('follows live stock: an OUT moves a material from Available to Low to Out of Stock', async () => {
    const m = await mk('MOVER', 20, 10);
    assert(!(await sheet(LOW)).ids.includes('MOVER'));
    await h.move(m, 'OUT', 12); // 8 <= 10
    assert(((await sheet(LOW)).ids.includes('MOVER')) && !(await sheet(OUT)).ids.includes('MOVER'));
    await h.move(m, 'OUT', 8); // 0
    assert(!(await sheet(LOW)).ids.includes('MOVER') && (await sheet(OUT)).ids.includes('MOVER'));
  });

  await t('no matches: still a valid, openable workbook with just the header row', async () => {
    for (const id of ['LOW', 'EDGE', 'MOVER']) { // clear the Low list
      const mid = (await call('GET', '/materials', undefined, h.user)).b.find((m) => m.materialId === id)._id;
      await call('PATCH', `/materials/${mid}/deactivate`, undefined, h.admin);
    }
    const low = await sheet(LOW);
    assert.deepStrictEqual(low.ids, []);
    assert.strictEqual(low.header.length, 7);
    for (const id of ['ZERO', 'ZEROMIN', 'MOVER']) {
      const mid = (await call('GET', '/materials', undefined, h.user)).b.find((m) => m.materialId === id)._id;
      await call('PATCH', `/materials/${mid}/deactivate`, undefined, h.admin);
    }
    const out = await sheet(OUT);
    assert.deepStrictEqual(out.ids, []);
    assert.strictEqual(out.header.length, 7);
  });

  await t('access: any approved user 200, unauthenticated 401', async () => {
    is(await get(LOW, h.admin), 200); is(await get(OUT, h.user), 200);
    is(await get(LOW, null), 401); is(await get(OUT, null), 401);
  });

  await h.finish();
})();
