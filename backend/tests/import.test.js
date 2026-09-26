// Stock import: preview / commit / history.
const setup = require('./harness');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const Material = require('../models/Material');
const Movement = require('../models/Movement');
const ImportBatch = require('../models/ImportBatch');
const AuditLog = require('../models/AuditLog');
const { ORDER } = require('../utils/costing');
const { HEADERS } = require('../utils/importParse');

(async () => {
  const h = await setup('import');
  const { t, is, assert, call, base, mongoose } = h;
  const U = h.user;
  const D = (s) => new Date(s); // exceljs date cell = UTC midnight

  const xlsx = async (rows, order = HEADERS) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(order);
    rows.forEach((r) => ws.addRow(order.map((k) => r[k])));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const R = (edp, o = {}) => ({ 'EDP No': edp, Size: o.size, 'Stock Qty': o.stock, 'Receipt Qty': o.rec, Rate: o.rate, 'Issue Qty': o.iss, 'Balance Qty': o.bal, 'Receive Date': o.rd, 'Issue Date': o.id });
  const upload = async (path, buf, name, token = U) => {
    const fd = new FormData();
    if (buf) fd.append('file', new Blob([buf]), name);
    const r = await fetch(base + path, { method: 'POST', headers: token ? { Cookie: 'token=' + token } : {}, body: fd });
    let b = null; try { b = await r.json(); } catch { /* empty */ }
    return { s: r.status, b };
  };
  const preview = (buf, name = 'stock.xlsx', token) => upload('/imports/preview', buf, name, token);
  const commit = (p, token = U) => call('POST', '/imports/commit', { filename: 'stock.xlsx', materials: p.materials, movements: p.movements }, token);
  const docx = async (rows) => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const tbl = rows ? `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>` : '';
    z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p>${tbl}<w:p/></w:body></w:document>`);
    return z.generateAsync({ type: 'nodebuffer' });
  };
  const counts = async () => JSON.stringify([await Material.countDocuments(), await Movement.countDocuments(), await ImportBatch.countDocuments(), await AuditLog.countDocuments()]);
  const byId = (p, id) => p.movements.find((m) => m.id === id);
  let commits = 0;

  // ---------- mixed file ----------
  const e1 = await h.newMaterial('E1');
  await h.move(e1, 'IN', 10, 100, { movementDate: '2025-01-01' });
  await h.move(e1, 'IN', 5, 50, { movementDate: '2025-01-05' });
  const mixed = await xlsx([
    R('E1', { rec: 5, rate: 50, rd: D('2025-01-05') }),                                   // row 2: duplicate of committed IN
    R('E1', { iss: 100, id: D('2025-02-01') }),                                           // row 3: exceeds stock
    R('e1', { rec: 2, rate: 60, rd: D('2025-02-01'), iss: 3, id: '02/02/2025', bal: 999 }), // row 4: ok + ok, balance mismatch
    R('N1', { size: 'Widget', stock: 20, rate: 7, rec: 5, rd: '2025-03-01' }),            // row 5: new material
    R('E1', { rec: 1, rate: 1, rd: 'abc' }),                                              // row 6: bad date
    R('E1', { rec: 'xx', rate: 1, rd: D('2025-03-01') }),                                 // row 7: non-numeric
    R('E1', { rec: 4, rd: D('2025-03-01') }),                                             // row 8: IN missing rate
    R('N1', { stock: 999, iss: 1, id: '2025-03-02' }),                                    // row 9: same new EDP, OUT
    {},                                                                                   // blank row ignored
  ]);
  let mp;
  await t('mixed file is classified correctly', async () => {
    const before = await counts();
    const r = await preview(mixed); is(r, 200); mp = r.b;
    assert.strictEqual(await counts(), before, 'preview must not write');
    assert.strictEqual(mp.filename, 'stock.xlsx');
    assert.strictEqual(byId(mp, 'r2-IN').status, 'duplicate-skip');
    assert.strictEqual(byId(mp, 'r3-OUT').status, 'rejected');
    assert.strictEqual(byId(mp, 'r3-OUT').reason, 'Cannot record OUT of 100: only 15 Bag available.');
    assert.strictEqual(byId(mp, 'r4-IN').status, 'ok');
    assert.strictEqual(byId(mp, 'r4-OUT').status, 'ok');
    assert.strictEqual(byId(mp, 'r4-OUT').movementDate, '2025-02-02');
    assert.strictEqual(byId(mp, 'r5-IN').status, 'new-material');
    assert.strictEqual(byId(mp, 'r8-IN').status, 'rejected');
    assert.strictEqual(byId(mp, 'r8-IN').reason, 'IN requires a rate');
    assert.strictEqual(byId(mp, 'r8-IN').rate, null);
    assert.deepStrictEqual(mp.parseErrors.map((e) => e.row), [6, 7]);
    assert.deepStrictEqual(mp.summary, { totalRows: 8, newMaterials: 1, willCreate: 4, willSkip: 1, willReject: 2, parseErrors: 2 });
    const keys = mp.movements.map((m) => m.edp + m.movementDate); // sorted by edp, date
    assert.deepStrictEqual(keys, [...keys].sort());
  });

  await t('new materials are flagged; Stock Qty of later rows ignored; unit TBD', () => {
    assert.deepStrictEqual(mp.materials, [{ edp: 'N1', description: 'Widget', unit: 'TBD', openingQuantity: 20, openingRate: 7 }]);
    assert(mp.movements.filter((m) => m.edp === 'N1').every((m) => m.newMaterial));
    assert(mp.movements.filter((m) => m.edp === 'E1').every((m) => !m.newMaterial));
  });

  await t('Balance Qty mismatch gives only an informational warning on the last movement of the row', () => {
    assert(byId(mp, 'r4-OUT').warning.includes('999'));
    assert(!byId(mp, 'r4-IN').warning);
    assert.strictEqual(byId(mp, 'r4-OUT').status, 'ok');
  });

  await t('commit creates only ok rows; duplicates and rejects create nothing', async () => {
    const before = await Movement.countDocuments();
    const r = await commit(mp); is(r, 200); commits++;
    assert.deepStrictEqual(r.b.summary, { rowCount: 6, created: 4, skipped: 1, failed: 2, newMaterials: 1 });
    assert.strictEqual(await Movement.countDocuments(), before + 4);
    assert.deepStrictEqual(r.b.createdMaterials, [{ materialId: 'N1', description: 'Widget', unit: 'TBD' }]);
    const n1 = await Material.findOne({ materialId: 'N1' }).lean();
    assert.strictEqual(n1.unit, 'TBD'); assert.strictEqual(n1.openingQuantity, 20); assert.strictEqual(n1.currentQuantity, 24);
    const res = Object.fromEntries(r.b.results.map((x) => [x.id, x]));
    assert.strictEqual(res['r2-IN'].status, 'skipped-duplicate');
    assert.strictEqual(res['r3-OUT'].status, 'failed');
    assert.strictEqual(res['r8-IN'].status, 'failed');
    assert.strictEqual(res['r4-OUT'].balanceAfter, 14);
    const mv = await Movement.findOne({ material: n1._id, type: 'IN' }).lean();
    assert.strictEqual(mv.note, 'Imported: stock.xlsx (row 5)');
    assert.strictEqual(String(mv.createdBy), String((await h.User.findOne({ email: 'bob@test.com' }))._id));
  });

  await t('committing the same file twice creates zero new movements', async () => {
    const before = await counts();
    const p2 = await preview(mixed); is(p2, 200);
    assert.strictEqual(p2.b.summary.willCreate, 0);
    assert.strictEqual(p2.b.materials.length, 0);
    const r = await commit(mp); is(r, 200); commits++;
    assert.strictEqual(r.b.summary.created, 0);
    assert.strictEqual(r.b.summary.newMaterials, 0);
    const after = JSON.parse(await counts()); const b = JSON.parse(before);
    assert.strictEqual(after[0], b[0]); assert.strictEqual(after[1], b[1]);
  });

  await t('Stock Qty is ignored for an existing EDP', async () => {
    const r = await preview(await xlsx([R('E1', { stock: 5000, rec: 1, rate: 10, rd: D('2025-04-01') })])); is(r, 200);
    assert.strictEqual(r.b.materials.length, 0);
    assert.strictEqual((await Material.findOne({ materialId: 'E1' })).openingQuantity, 0);
  });

  // ---------- back-dated equivalence ----------
  await t('a back-dated import row gives exactly the same numbers as POST /movements', async () => {
    const A = await h.newMaterial('TWA'), B = await h.newMaterial('TWB');
    for (const m of [A, B]) {
      await h.move(m, 'IN', 10, 100, { movementDate: '2025-01-01' });
      await h.move(m, 'IN', 10, 120, { movementDate: '2025-03-01' });
      await h.move(m, 'OUT', 5, undefined, { movementDate: '2025-03-15' });
    }
    const p = await preview(await xlsx([R('TWA', { rec: 5, rate: 90, rd: D('2025-02-01'), iss: 3, id: D('2025-02-10') })])); is(p, 200);
    assert.strictEqual(p.b.summary.willCreate, 2);
    is(await commit(p.b), 200); commits++;
    is(await h.move(B, 'IN', 5, 90, { movementDate: '2025-02-01' }), 201);
    is(await h.move(B, 'OUT', 3, undefined, { movementDate: '2025-02-10' }), 201);
    const snap = async (id) => ({
      mv: (await Movement.find({ material: id }).sort(ORDER).lean()).map((m) => [m.type, m.quantity, m.rate, m.enteredRate, m.amount, m.balanceAfter, m.movementDate.toISOString()]),
      mat: (({ currentQuantity, currentRate }) => ({ currentQuantity, currentRate }))(await Material.findById(id).lean()),
    });
    assert.deepStrictEqual(await snap(A), await snap(B));
  });

  await t('back-dated OUT that would make stock negative is rejected in preview and commit', async () => {
    const m = await h.newMaterial('BD1');
    await h.move(m, 'IN', 10, 10, { movementDate: '2025-05-10' });
    await h.move(m, 'OUT', 8, undefined, { movementDate: '2025-05-20' });
    const p = await preview(await xlsx([R('BD1', { iss: 5, id: D('2025-05-15') })])); is(p, 200);
    assert.strictEqual(p.b.movements[0].status, 'rejected');
    assert(p.b.movements[0].reason.startsWith('Cannot insert this back-dated OUT'));
    const forced = { ...p.b, movements: p.b.movements.map((x) => ({ ...x, status: 'ok' })) }; // client status is ignored
    const c = await commit(forced); commits++;
    assert.strictEqual(c.b.results[0].status, 'failed');
  });

  await t('inactive material rows are rejected', async () => {
    const m = await h.newMaterial('INA');
    await Material.updateOne({ _id: m }, { isActive: false });
    const p = await preview(await xlsx([R('INA', { rec: 1, rate: 1, rd: D('2025-01-01') })])); is(p, 200);
    assert.strictEqual(p.b.movements[0].reason, 'Material is inactive');
  });

  await t('column order does not matter; DD-MM-YYYY dates accepted', async () => {
    const p = await preview(await xlsx([R('SH1', { size: 'Bolt', stock: 3, rate: 2, rec: 1, rd: '15-03-2025' })], [...HEADERS].reverse())); is(p, 200);
    assert.deepStrictEqual(p.b.materials, [{ edp: 'SH1', description: 'Bolt', unit: 'TBD', openingQuantity: 3, openingRate: 2 }]);
    assert.strictEqual(p.b.movements[0].movementDate, '2025-03-15');
    assert.strictEqual(p.b.movements[0].status, 'new-material');
  });

  await t('previewed OUT is re-validated at commit against current stock', async () => {
    const m = await h.newMaterial('RV1');
    await h.move(m, 'IN', 10, 5, { movementDate: '2025-06-01' });
    const p = await preview(await xlsx([R('RV1', { iss: 8, id: D('2025-06-02') })])); is(p, 200);
    assert.strictEqual(p.b.movements[0].status, 'ok');
    is(await h.move(m, 'OUT', 5, undefined, { movementDate: '2025-06-01' }), 201);
    const c = await commit(p.b); is(c, 200); commits++;
    assert.strictEqual(c.b.results[0].status, 'failed');
    assert(c.b.results[0].reason.startsWith('Cannot record OUT of 8'));
  });

  await t('commit: unknown material and invalid movements fail individually; batch continues', async () => {
    const c = await call('POST', '/imports/commit', { filename: 'x.xlsx', materials: [], movements: [
      { id: 'a', row: 2, edp: 'NOPE', type: 'IN', quantity: 1, rate: 1, movementDate: '2025-01-01' },
      { id: 'b', row: 3, edp: 'E1', type: 'IN', quantity: -1, rate: 1, movementDate: '2025-01-01' },
      { id: 'c', row: 4, edp: 'E1', type: 'IN', quantity: 1, movementDate: '2025-01-01' },
      { id: 'd', row: 5, edp: 'E1', type: 'OUT', quantity: 1, movementDate: '2025-13-40' },
      { id: 'e', row: 6, edp: 'E1', type: 'IN', quantity: 1, rate: 3, movementDate: '2025-07-01' },
    ] }, U); is(c, 200); commits++;
    assert.deepStrictEqual(c.b.results.map((r) => r.status), ['failed', 'failed', 'failed', 'failed', 'created']);
    assert.strictEqual(c.b.results[0].reason, 'Unknown material');
    is(await call('POST', '/imports/commit', { movements: 'x' }, U), 400);
  });

  // ---------- Word ----------
  await t('valid docx table imports (blank-cell rows ignored)', async () => {
    const p = await upload('/imports/preview', await docx([HEADERS, ['DX2', 'Nut', '4', '2', '3', '', '', '01/04/2025', ''], ['', '', '', '', '', '', '', '', '']]), 'a.docx'); is(p, 200);
    assert.strictEqual(p.b.summary.willCreate, 1); assert.strictEqual(p.b.movements[0].movementDate, '2025-04-01'); assert.strictEqual(p.b.materials[0].edp, 'DX2');
  });
  await t('docx with no table / wrong headers rejected with the specific message', async () => {
    const head = 'Could not find a table with an "EDP No" (or "Material ID") column — got: ';
    let r = await upload('/imports/preview', await docx(null), 'a.docx'); is(r, 400);
    assert.strictEqual(r.b.message, head + 'no table');
    r = await upload('/imports/preview', await docx([['A', 'B'], ['1', '2']]), 'a.docx'); is(r, 400);
    assert.strictEqual(r.b.message, head + 'A, B');
    r = await upload('/imports/preview', Buffer.from('not a zip'), 'a.docx'); is(r, 400);
    assert.strictEqual(r.b.message, head + 'unreadable document');
  });

  // ---------- optional columns: only EDP No + one of Receipt Qty / Issue Qty are required ----------
  const dayNow = () => new Date().toISOString().slice(0, 10);
  const NOQTY = 'File needs at least a Receipt Qty, Issue Qty, or Current Qty column (optional: Size/Description, Unit, Stock Qty, Rate, Balance Qty, Receive Date, Issue Date)';
  await t('minimal file (EDP No + Receipt Qty + Receive Date only) is accepted; missing Size/Stock/Rate/Balance behave like blank cells', async () => {
    const p = await preview(await xlsx([R('MN1', { rec: 5, rd: D('2025-06-01') })], ['EDP No', 'Receipt Qty', 'Receive Date'])); is(p, 200);
    assert.deepStrictEqual(p.b.parseErrors, []);
    assert.deepStrictEqual(p.b.materials, [{ edp: 'MN1', description: 'MN1', unit: 'TBD', openingQuantity: 0, openingRate: 0 }]); // no Size -> EDP, no Stock Qty -> 0
    assert.strictEqual(p.b.movements.length, 1);
    assert.strictEqual(p.b.movements[0].status, 'rejected'); assert.strictEqual(p.b.movements[0].reason, 'IN requires a rate'); // no Rate column: fixable in the preview
    assert.strictEqual(p.b.movements[0].movementDate, '2025-06-01');
    // once the admin supplies the rate, it commits normally
    const fixed = { ...p.b, movements: p.b.movements.map((x) => ({ ...x, rate: 4, status: 'ok' })) };
    const c = await commit(fixed); commits++;
    assert.strictEqual(c.b.summary.created, 1);
    const m = await Material.findOne({ materialId: 'MN1' }); assert.strictEqual(m.currentQuantity, 5);
  });
  await t('Issue-only file (EDP No + Issue Qty + Issue Date) works against an existing material', async () => {
    const m = await h.newMaterial('MN2', { openingQuantity: 10, openingRate: 3 });
    const p = await preview(await xlsx([R('MN2', { iss: 4, id: D('2025-06-02') })], ['EDP No', 'Issue Qty', 'Issue Date'])); is(p, 200);
    assert.deepStrictEqual(p.b.materials, []);
    assert.strictEqual(p.b.movements[0].status, 'ok'); assert.strictEqual(p.b.movements[0].type, 'OUT');
    assert(m);
  });
  await t('Receive Date COLUMN missing entirely: rows get today\'s date and an informational warning, not an error', async () => {
    h.assert(await h.newMaterial('MD1', { openingQuantity: 1, openingRate: 1 }));
    const before = dayNow();
    const p = await preview(await xlsx([R('MD1', { rec: 3, rate: 2 })], ['EDP No', 'Receipt Qty', 'Rate'])); is(p, 200);
    const after = dayNow();
    assert.deepStrictEqual(p.b.parseErrors, []);
    const mv = p.b.movements[0];
    assert(mv.movementDate === before || mv.movementDate === after, mv.movementDate);
    assert.strictEqual(mv.status, 'ok');
    assert.strictEqual(mv.warning, "No Receive Date column in file — used today's date.");
    const c = await commit(p.b); commits++;
    assert.strictEqual(c.b.summary.created, 1);
    const saved = await mongoose.models.Movement.findOne({ note: /row 2/, quantity: 3, type: 'IN' }).sort({ createdAt: -1 });
    assert.strictEqual(saved.movementDate.toISOString().slice(0, 10), mv.movementDate);
  });
  await t('Issue Date COLUMN missing entirely: same rule for OUT rows', async () => {
    await h.newMaterial('MD2', { openingQuantity: 10, openingRate: 1 });
    const p = await preview(await xlsx([R('MD2', { iss: 2 })], ['EDP No', 'Issue Qty'])); is(p, 200);
    assert.deepStrictEqual(p.b.parseErrors, []);
    assert.strictEqual(p.b.movements[0].warning, "No Issue Date column in file — used today's date.");
    assert.strictEqual(p.b.movements[0].status, 'ok');
  });
  await t('date column present but BLANK on a row is still a per-row error (unchanged)', async () => {
    await h.newMaterial('MD3', { openingQuantity: 1, openingRate: 1 });
    const p = await preview(await xlsx([R('MD3', { rec: 3, rate: 2 }), R('MD3', { rec: 1, rate: 2, rd: D('2025-07-01') })], ['EDP No', 'Receipt Qty', 'Rate', 'Receive Date'])); is(p, 200);
    assert.strictEqual(p.b.parseErrors.length, 1); assert.match(p.b.parseErrors[0].message, /Receive Date is required/);
    assert.strictEqual(p.b.movements.length, 1); assert(!p.b.movements[0].warning);
  });
  await t('a default-date warning sits next to a balance warning without hiding it', async () => {
    await h.newMaterial('MD4', { openingQuantity: 5, openingRate: 1 });
    const p = await preview(await xlsx([R('MD4', { rec: 1, rate: 1, bal: 999 })], ['EDP No', 'Receipt Qty', 'Rate', 'Balance Qty'])); is(p, 200);
    assert.match(p.b.movements[0].warning, /used today's date\./); assert.match(p.b.movements[0].warning, /File balance 999 differs/);
  });
  await t('no quantity column at all is rejected with the specific message (EDP No + Size + Rate only; EDP No alone)', async () => {
    let r = await preview(await xlsx([R('Q1', { size: 'x', rate: 1 })], ['EDP No', 'Size', 'Rate'])); is(r, 400);
    assert.strictEqual(r.b.message, NOQTY);
    r = await preview(await xlsx([R('Q2')], ['EDP No'])); is(r, 400);
    assert.strictEqual(r.b.message, NOQTY);
  });
  await t('no EDP No column is rejected even when quantities exist', async () => {
    const r = await preview(await xlsx([R('Q3', { size: 'x', rec: 1, rd: D('2025-01-01') })], ['Size', 'Receipt Qty', 'Receive Date'])); is(r, 400);
    assert(r.b.message.startsWith('Could not find a table with an "EDP No" (or "Material ID") column'), r.b.message);
    assert(r.b.message.endsWith('got: Size, Receipt Qty, Receive Date'), r.b.message);
  });
  await t('the same relaxation applies to Word tables (shared parser): dates missing -> today, no quantity column -> rejected', async () => {
    await h.newMaterial('WD1', { openingQuantity: 1, openingRate: 1 });
    let p = await upload('/imports/preview', await docx([['EDP No', 'Receipt Qty', 'Rate'], ['WD1', '2', '3']]), 'a.docx'); is(p, 200);
    assert.strictEqual(p.b.movements[0].movementDate.length, 10); assert.strictEqual(p.b.movements[0].warning, "No Receive Date column in file — used today's date.");
    p = await upload('/imports/preview', await docx([['EDP No', 'Size'], ['WD1', 'x']]), 'a.docx'); is(p, 400);
    assert.strictEqual(p.b.message, NOQTY);
  });
  await t('a full 9-column file still behaves exactly as before (no default-date warnings)', async () => {
    await h.newMaterial('FULL1', { openingQuantity: 1, openingRate: 1 });
    const p = await preview(await xlsx([R('FULL1', { size: 'S', stock: 9, rec: 2, rate: 5, iss: 1, bal: 2, rd: D('2025-08-01'), id: D('2025-08-02') })])); is(p, 200);
    assert.deepStrictEqual(p.b.parseErrors, []);
    assert(p.b.movements.every((x) => !x.warning || /File balance/.test(x.warning)));
    assert.deepStrictEqual(p.b.movements.map((x) => x.movementDate), ['2025-08-01', '2025-08-02']);
  });

  // ---------- SYNC MODE: a Current Qty snapshot, no Receipt/Issue columns at all ----------
  const RS = (edp, o = {}) => ({ 'EDP No': edp, Size: o.size, Unit: o.unit, 'Stock Qty': o.stock, Rate: o.rate, 'Current Qty': o.current });
  const SYNC_ORDER = ['EDP No', 'Size', 'Unit', 'Stock Qty', 'Rate', 'Current Qty'];
  const syncXlsx = (rows) => xlsx(rows, SYNC_ORDER);

  await t('snapshot-only file (Material ID, Description, Unit, Current Qty, Rate) parses and plans in sync mode', async () => {
    const p = await preview(await xlsx(
      [{ 'Material ID': 'SY1', Description: 'Widget', Unit: 'Nos', 'Current Qty': 12, Rate: 3 }],
      ['Material ID', 'Description', 'Unit', 'Current Qty', 'Rate'],
    )); is(p, 200);
    assert.strictEqual(p.b.mode, 'sync');
    assert.deepStrictEqual(p.b.parseErrors, []);
    assert.strictEqual(p.b.movements[0].status, 'new-material');
    assert.strictEqual(p.b.movements[0].edp, 'SY1');
  });

  await t('new material from a snapshot file gets the file\'s Unit, not TBD', async () => {
    const p = await preview(await syncXlsx([RS('SY2', { size: 'Bolt', unit: 'Box', current: 7, rate: 4 })])); is(p, 200);
    assert.deepStrictEqual(p.b.materials, [{ edp: 'SY2', description: 'Bolt', unit: 'Box', openingQuantity: 7, openingRate: 4 }]);
    const c = await commit(p.b); commits++;
    assert.strictEqual(c.b.createdMaterials[0].unit, 'Box');
    const m = await Material.findOne({ materialId: 'SY2' });
    assert.strictEqual(m.unit, 'Box'); assert.strictEqual(m.currentQuantity, 7);
  });

  await t('missing Unit column: new material still defaults to TBD (unchanged)', async () => {
    const p = await preview(await syncXlsx([RS('SY3', { current: 5, rate: 1 })])); is(p, 200);
    assert.strictEqual(p.b.materials[0].unit, 'TBD');
  });

  await t('existing material, file Current Qty HIGHER than system: a positive adjustment IN is created, note names both numbers', async () => {
    const m = await h.newMaterial('SY4', { unit: 'Nos', openingQuantity: 10, openingRate: 2 });
    const p = await preview(await syncXlsx([RS('SY4', { current: 30, rate: 5 })])); is(p, 200);
    assert.strictEqual(p.b.movements[0].status, 'sync-adjustment');
    assert.strictEqual(p.b.movements[0].type, 'IN'); assert.strictEqual(p.b.movements[0].delta, 20);
    const c = await commit(p.b); commits++;
    assert.strictEqual(c.b.results[0].status, 'created');
    const mv = await mongoose.models.Movement.findOne({ material: m, type: 'IN' }).sort({ createdAt: -1 });
    assert.strictEqual(mv.quantity, 20); assert.strictEqual(mv.enteredRate, 5);
    assert.strictEqual(mv.note, 'Stock sync from import: file states 30, system had 10');
    assert.strictEqual((await Material.findById(m)).currentQuantity, 30);
  });

  await t('existing material, file Current Qty LOWER than system: an adjustment OUT is created, never rejected by the stock-exceeds check', async () => {
    const m = await h.newMaterial('SY5', { unit: 'Nos', openingQuantity: 50, openingRate: 2 });
    const p = await preview(await syncXlsx([RS('SY5', { current: 8 })])); is(p, 200);
    assert.strictEqual(p.b.movements[0].type, 'OUT'); assert.strictEqual(p.b.movements[0].delta, -42);
    const c = await commit(p.b); commits++;
    assert.strictEqual(c.b.results[0].status, 'created');
    const mv = await mongoose.models.Movement.findOne({ material: m, type: 'OUT' }).sort({ createdAt: -1 });
    assert.strictEqual(mv.quantity, 42); assert.match(mv.note, /file states 8, system had 50/);
    assert.strictEqual((await Material.findById(m)).currentQuantity, 8);
  });

  await t('adjustment OUT with no Rate column still commits (rate falls back to the material\'s current rate, never blocks)', async () => {
    const m = await h.newMaterial('SY5B', { unit: 'Nos', openingQuantity: 20, openingRate: 9 });
    const p = await preview(await xlsx([{ 'EDP No': 'SY5B', 'Current Qty': 3 }], ['EDP No', 'Current Qty'])); is(p, 200);
    assert.strictEqual(p.b.movements[0].status, 'sync-adjustment');
    const c = await commit(p.b); commits++;
    assert.strictEqual(c.b.results[0].status, 'created');
    assert.strictEqual((await Material.findById(m)).currentQuantity, 3);
  });

  await t('existing material, file Current Qty EQUAL to system: zero movements, row marked already-matches', async () => {
    const m = await h.newMaterial('SY6', { unit: 'Nos', openingQuantity: 15, openingRate: 2 });
    const before = await mongoose.models.Movement.countDocuments({ material: m });
    const p = await preview(await syncXlsx([RS('SY6', { current: 15 })])); is(p, 200);
    assert.strictEqual(p.b.movements[0].status, 'already-matches'); assert.strictEqual(p.b.movements[0].delta, 0);
    const c = await commit(p.b); commits++;
    assert.strictEqual(c.b.summary.created, 0);
    assert.strictEqual(await mongoose.models.Movement.countDocuments({ material: m }), before);
  });

  await t('a file with BOTH Receipt/Issue AND Current Qty columns is movement mode: Current Qty is ignored entirely', async () => {
    const m = await h.newMaterial('SY7', { unit: 'Nos', openingQuantity: 100, openingRate: 1 });
    const p = await preview(await xlsx(
      [{ 'EDP No': 'SY7', 'Receipt Qty': 5, Rate: 2, 'Receive Date': D('2025-09-01'), 'Current Qty': 999 }],
      ['EDP No', 'Receipt Qty', 'Rate', 'Receive Date', 'Current Qty'],
    )); is(p, 200);
    assert.strictEqual(p.b.mode, 'movement');
    assert.strictEqual(p.b.movements[0].mode, 'movement'); assert.strictEqual(p.b.movements[0].type, 'IN'); assert.strictEqual(p.b.movements[0].quantity, 5);
    const c = await commit(p.b); commits++;
    assert.strictEqual((await Material.findById(m)).currentQuantity, 105); // not anywhere near 999
  });

  await t('re-importing the exact same snapshot file twice: the second import shows every row as already-matches, nothing new is created', async () => {
    await h.newMaterial('SY8', { unit: 'Nos', openingQuantity: 4, openingRate: 1 });
    const buf = await syncXlsx([RS('SY8', { current: 25, rate: 3 })]);
    const p1 = await preview(buf); is(p1, 200);
    await commit(p1.b); commits++;
    const p2 = await preview(buf); is(p2, 200);
    assert.strictEqual(p2.b.movements[0].status, 'already-matches');
    const before = await mongoose.models.Movement.countDocuments({});
    const c2 = await commit(p2.b); commits++;
    assert.strictEqual(c2.b.summary.created, 0);
    assert.strictEqual(await mongoose.models.Movement.countDocuments({}), before);
  });

  await t('a snapshot file with a NEGATIVE Current Qty value is rejected as a row-level parse error, not silently processed', async () => {
    const p = await preview(await syncXlsx([RS('SY9', { current: -5 })])); is(p, 200);
    assert.strictEqual(p.b.movements.length, 0);
    assert.strictEqual(p.b.parseErrors.length, 1);
    assert.match(p.b.parseErrors[0].message, /Current Qty must be a non-negative number/);
  });

  await t('"Material ID" is recognised identically to "EDP No"', async () => {
    const m = await h.newMaterial('SY10', { unit: 'Nos', openingQuantity: 6, openingRate: 1 });
    const p = await preview(await xlsx([{ 'Material ID': 'SY10', 'Current Qty': 9 }], ['Material ID', 'Current Qty'])); is(p, 200);
    assert.strictEqual(p.b.movements[0].edp, 'SY10'); assert.strictEqual(p.b.movements[0].delta, 3);
    assert(m);
  });

  await t('a snapshot file with no Current Qty and no Receipt/Issue column is rejected with the updated message', async () => {
    const p = await preview(await xlsx([{ 'EDP No': 'SY11', Size: 'x' }], ['EDP No', 'Size'])); is(p, 400);
    assert.strictEqual(p.b.message, NOQTY);
  });

  await t('two rows for the same material in one snapshot file: the later row wins, the earlier is superseded', async () => {
    const m = await h.newMaterial('SY12', { unit: 'Nos', openingQuantity: 0, openingRate: 1 });
    const p = await preview(await syncXlsx([RS('SY12', { current: 5 }), RS('SY12', { current: 11 })])); is(p, 200);
    assert.strictEqual(p.b.movements.length, 2);
    const sup = p.b.movements.find((x) => x.status === 'duplicate-skip'), win = p.b.movements.find((x) => x.status === 'sync-adjustment');
    assert(sup && win); assert.strictEqual(win.delta, 11);
    const c = await commit(p.b); commits++;
    assert.strictEqual((await Material.findById(m)).currentQuantity, 11);
  });

  await t('.xls / .txt / no file / corrupt xlsx / oversize are rejected 400', async () => {
    let r = await preview(Buffer.from('x'), 'old.xls'); is(r, 400); assert(r.b.message.includes('.xlsx'));
    is(await preview(Buffer.from('x'), 'a.txt'), 400);
    is(await upload('/imports/preview', null), 400);
    is(await preview(Buffer.from('garbage'), 'a.xlsx'), 400);
    r = await preview(Buffer.alloc(11 * 1024 * 1024), 'big.xlsx'); is(r, 400); assert(r.b.message.includes('10 MB'));
  });

  await t('normal user can preview/commit/list; unauthenticated gets 401', async () => {
    is(await call('GET', '/imports', undefined, U), 200);
    is(await call('GET', '/imports'), 401);
    is(await call('POST', '/imports/commit', { movements: [] }), 401);
    is(await upload('/imports/preview', mixed, 'a.xlsx', null), 401);
    const r = await call('GET', '/imports', undefined, U);
    assert.strictEqual(r.b.total, commits);
    assert.strictEqual(r.b.data[0].uploadedBy.name, 'Bob');
    assert.deepStrictEqual(Object.keys(r.b.data[0]).sort(), ['_id', 'createdCount', 'filename', 'rejectedCount', 'rowCount', 'skippedCount', 'uploadedAt', 'uploadedBy']);
    is(await call('GET', '/imports?page=0', undefined, U), 400);
  });

  await t('audit IMPORT_COMMIT once per commit with the 4 fields; ImportBatch per commit', async () => {
    const logs = await AuditLog.find({ action: 'IMPORT_COMMIT' }).lean();
    assert.strictEqual(logs.length, commits);
    assert.strictEqual(await ImportBatch.countDocuments(), commits);
    const first = logs.find((l) => l.details.createdCount === 4);
    assert.deepStrictEqual(first.details, { filename: 'stock.xlsx', createdCount: 4, skippedCount: 1, rejectedCount: 2 });
  });

  await t('only expected collections exist; no raw file stored', async () => {
    const names = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
    for (const n of names) assert(['materials', 'movements', 'importbatches', 'auditlogs', 'users', 'loginattempts'].includes(n), 'unexpected collection ' + n);
    assert(!JSON.stringify(await ImportBatch.find().lean()).includes('buffer'));
  });

  await h.finish();
})();
