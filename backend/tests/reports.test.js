// Phase 6: dashboard + Excel/PDF reports
const ExcelJS = require('exceljs');
const pdfParse = require('pdf-parse');
const setup = require('./harness');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// pdf-parse's 2018 pdf.js randomly rejects valid pdfkit output (~7%, xref offsets verified correct), so re-fetch on parse error.
const parsePdf = async (fetchPdf) => {
  for (let i = 0; i < 6; i++) { try { const r = await fetchPdf(); return { r, d: await pdfParse(r.buf) }; } catch (e) { if (i === 5) throw e; } }
};
const sheet = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb.worksheets[0]; };

(async () => {
  const h = await setup('reports');
  const { t, is, call, assert } = h;
  const A = h.admin, U = h.user;
  const get = (p, tok = U) => call('GET', p, undefined, tok, true);

  // ---------- break first: empty DB ----------
  await t('empty: dashboard returns empty structure', async () => {
    const r = await call('GET', '/reports/dashboard', undefined, U); is(r, 200);
    assert.deepStrictEqual(r.b, { totalMaterials: 0, totalStockValue: 0, lowStockCount: 0, outOfStockCount: 0, materials: [] });
  });
  await t('empty: stock excel = header only', async () => {
    const r = await get('/reports/stock-value/excel'); is(r, 200);
    const ws = await sheet(r.buf); assert.strictEqual(ws.rowCount, 1);
  });
  await t('empty: stock pdf valid', async () => {
    const r = await get('/reports/stock-value/pdf'); is(r, 200);
    assert.strictEqual(r.buf.slice(0, 5).toString(), '%PDF-');
    assert(r.buf.slice(-8).toString().includes('%%EOF')); // pdf-parse's old xref reader chokes on 1-page toy PDFs, so no text parse here
  });
  await t('empty: movements excel = header only', async () => {
    const r = await get('/reports/movements/excel'); is(r, 200);
    assert.strictEqual((await sheet(r.buf)).rowCount, 1);
  });

  // ---------- data ----------
  const c = await h.newMaterial('MAT001', { description: 'Cement', unit: 'Bag', minimumQuantity: 50 });
  const s = await h.newMaterial('MAT002', { description: 'Steel Rod', unit: 'Nos', minimumQuantity: 20 });
  const b = await h.newMaterial('MAT003', { description: 'Bricks', unit: 'Nos', minimumQuantity: 10 });
  const gone = await h.newMaterial('MAT004', { description: 'Retired', unit: 'Nos' });
  await h.move(c, 'IN', 120, 400, { movementDate: '2026-03-01', note: 'first' });
  await h.move(s, 'IN', 15, 650, { movementDate: '2026-03-05' });
  await h.move(b, 'IN', 5, 8, { movementDate: '2026-03-10' });
  await h.move(b, 'OUT', 5, undefined, { movementDate: '2026-03-12' });
  await h.move(gone, 'IN', 10, 100);
  await call('PATCH', `/materials/${gone}/deactivate`, undefined, A);

  // ---------- brutal ----------
  await t('dashboard numbers match DB state', async () => {
    const r = await call('GET', '/reports/dashboard', undefined, U); is(r, 200);
    assert.strictEqual(r.b.totalMaterials, 3);                    // inactive excluded
    assert.strictEqual(r.b.totalStockValue, 48000 + 9750 + 0);    // 120*400 + 15*650 + 0
    assert.strictEqual(r.b.lowStockCount, 1);
    assert.strictEqual(r.b.outOfStockCount, 1);
    const by = Object.fromEntries(r.b.materials.map((m) => [m.materialId, m]));
    assert(by.MAT001.status === 'AVAILABLE' && by.MAT001.stockValue === 48000);
    assert(by.MAT002.status === 'LOW_STOCK' && by.MAT002.stockValue === 9750);
    assert(by.MAT003.status === 'OUT_OF_STOCK' && by.MAT003.stockValue === 0);
    assert(!by.MAT004);
  });
  await t('dashboard reflects a new movement immediately', async () => {
    await h.move(s, 'IN', 100, 650);
    const r = await call('GET', '/reports/dashboard', undefined, U);
    assert.strictEqual(r.b.lowStockCount, 0);
    assert.strictEqual(r.b.totalStockValue, 48000 + 115 * 650);
  });
  await t('stock excel: headers + rows', async () => {
    const r = await get('/reports/stock-value/excel'); is(r, 200);
    assert.strictEqual(r.headers.get('content-type'), XLSX);
    assert(/attachment; filename=".*\.xlsx"/.test(r.headers.get('content-disposition')));
    const ws = await sheet(r.buf);
    assert.strictEqual(ws.rowCount, 4); // header + 3 active
    assert.deepStrictEqual(ws.getRow(1).values.slice(1), ['Material ID', 'Description', 'Unit', 'Current Qty', 'Rate', 'Stock Value', 'Status']);
    assert.deepStrictEqual(ws.getRow(2).values.slice(1), ['MAT001', 'Cement', 'Bag', 120, 400, 48000, 'Available']);
    assert.strictEqual(ws.getRow(4).getCell(7).value, 'Out of Stock');
  });
  await t('stock pdf: headers + content', async () => {
    const { r, d } = await parsePdf(() => get('/reports/stock-value/pdf')); is(r, 200);
    assert.strictEqual(r.headers.get('content-type'), 'application/pdf');
    assert(/attachment; filename=".*\.pdf"/.test(r.headers.get('content-disposition')));
    assert.strictEqual(r.buf.slice(0, 5).toString(), '%PDF-');
    const text = d.text;
    for (const w of ['MAT001', 'MAT002', 'MAT003', 'Cement', '48000.00']) assert(text.includes(w), 'missing ' + w);
    assert(!text.includes('MAT004'));
  });
  await t('stock pdf paginates many rows', async () => {
    for (let i = 0; i < 40; i++) await h.newMaterial('BULK' + String(i).padStart(2, '0'));
    const { r, d } = await parsePdf(() => get('/reports/stock-value/pdf')); is(r, 200);
    assert(d.numpages > 1);
    assert(d.text.includes('BULK39'));
  });
  await t('movements excel: all rows + columns', async () => {
    const r = await get('/reports/movements/excel'); is(r, 200);
    assert.strictEqual(r.headers.get('content-type'), XLSX);
    const ws = await sheet(r.buf);
    assert.strictEqual(ws.rowCount, 1 + 6); // 5 seeded + 1 added by dashboard test
    assert.deepStrictEqual(ws.getRow(1).values.slice(1), ['Date', 'Material ID', 'Description', 'Type', 'Qty', 'Rate', 'Amount', 'Balance', 'Entered By', 'Note']);
    const first = ws.getRow(2).values.slice(1);
    assert.deepStrictEqual(first.slice(0, 9), ['2026-03-01', 'MAT001', 'Cement', 'IN', 120, 400, 48000, 120, 'Bob']);
    assert.strictEqual(first[9], 'first');
  });
  await t('movements excel: material filter', async () => {
    const ws = await sheet((await get(`/reports/movements/excel?material=${b}`)).buf);
    assert.strictEqual(ws.rowCount, 3);
    assert.strictEqual(ws.getRow(3).getCell(4).value, 'OUT');
  });
  await t('movements excel: from/to filter (date-only "to" is inclusive)', async () => {
    let ws = await sheet((await get('/reports/movements/excel?from=2026-03-05&to=2026-03-10')).buf);
    assert.strictEqual(ws.rowCount, 3); // Mar 5 and Mar 10
    ws = await sheet((await get('/reports/movements/excel?from=2026-03-11&to=2026-03-12')).buf);
    assert.strictEqual(ws.rowCount, 2);
    ws = await sheet((await get(`/reports/movements/excel?material=${c}&from=2026-03-01`)).buf);
    assert.strictEqual(ws.rowCount, 2);
  });
  await t('reports open to any approved user, need auth', async () => {
    is(await get('/reports/dashboard', A), 200);
    for (const p of ['dashboard', 'stock-value/excel', 'stock-value/pdf', 'movements/excel']) is(await call('GET', '/reports/' + p), 401);
  });

  // ---------- break ----------
  await t('filter with no matches = header only, not error', async () => {
    const ws = await sheet((await get('/reports/movements/excel?from=2030-01-01&to=2030-12-31')).buf);
    assert.strictEqual(ws.rowCount, 1);
  });
  await t('invalid dates -> 400 JSON', async () => {
    for (const q of ['from=garbage', 'to=32-13-2026', 'from=2026-13-45']) {
      const r = await call('GET', '/reports/movements/excel?' + q, undefined, U); is(r, 400);
    }
  });
  await t('from after to -> 400', async () => is(await call('GET', '/reports/movements/excel?from=2026-04-01&to=2026-03-01', undefined, U), 400));
  await t('bad material id -> 400', async () => is(await call('GET', '/reports/movements/excel?material=zzz', undefined, U), 400));
  await t('unknown-but-valid material id -> empty sheet', async () => {
    const ws = await sheet((await get(`/reports/movements/excel?material=${new h.mongoose.Types.ObjectId()}`)).buf);
    assert.strictEqual(ws.rowCount, 1);
  });

  await h.finish();
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
