const mongoose = require('mongoose');
const { isId } = require('../middleware/fields');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Material = require('../models/Material');
const Movement = require('../models/Movement');
const { ORDER } = require('../utils/costing');

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (res.headersSent) return res.destroy(e); // streaming already began: a truncated download must look truncated
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};
const STATUS = { AVAILABLE: 'Available', LOW_STOCK: 'Low Stock', OUT_OF_STOCK: 'Out of Stock' };
const stamp = () => new Date().toISOString().slice(0, 10);

// Stock report covers active materials only, same basis as the dashboard.
const activeMaterials = () => Material.find({ isActive: true }).sort({ materialId: 1 });

exports.dashboard = wrap(async (req, res) => {
  const ms = await activeMaterials();
  res.json({
    totalMaterials: ms.length,
    totalStockValue: Math.round(ms.reduce((s, m) => s + m.stockValue, 0) * 100) / 100,
    lowStockCount: ms.filter((m) => m.status === 'LOW_STOCK').length,
    outOfStockCount: ms.filter((m) => m.status === 'OUT_OF_STOCK').length,
    materials: ms.map((m) => ({
      _id: m._id, materialId: m.materialId, description: m.description, unit: m.unit,
      currentQuantity: m.currentQuantity, currentRate: m.currentRate, minimumQuantity: m.minimumQuantity,
      stockValue: m.stockValue, status: m.status,
    })),
  });
});

// Exports are complete (every matching row) but never held in memory: rows come from a database cursor and are
// written to the response as they arrive, so memory stays flat however large the dataset is.
async function streamWorkbook(res, filename, sheetName, columns, rows) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns;
  const header = ws.getRow(1);
  header.values = columns.map((c) => c.header);
  header.font = { bold: true };
  header.commit();
  for await (const row of rows) ws.addRow(row).commit();
  ws.commit();
  await wb.commit();
}

const BATCH = 500;
async function* cursorRows(cursor, map) {
  try { for await (const doc of cursor) yield map(doc); } finally { await cursor.close().catch(() => {}); }
}
const activeMaterialCursor = () => Material.find({ isActive: true }).sort({ materialId: 1 }).cursor({ batchSize: BATCH });

exports.stockExcel = wrap(async (req, res) => {
  await streamWorkbook(res, `stock-value-${stamp()}.xlsx`, 'Stock Value', [
    { header: 'Material ID', key: 'id', width: 16 }, { header: 'Description', key: 'desc', width: 32 },
    { header: 'Unit', key: 'unit', width: 10 }, { header: 'Current Qty', key: 'qty', width: 14 },
    { header: 'Rate', key: 'rate', width: 12 }, { header: 'Stock Value', key: 'value', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
  ], cursorRows(activeMaterialCursor(), (m) => ({
    id: m.materialId, desc: m.description, unit: m.unit, qty: m.currentQuantity,
    rate: m.currentRate, value: m.stockValue, status: STATUS[m.status],
  })));
});

exports.stockPdf = wrap(async (req, res) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="stock-value-${stamp()}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).text('Stock Value Report', { align: 'center' });
  doc.fontSize(9).text(`Generated ${new Date().toISOString().slice(0, 10)}`, { align: 'center' }).moveDown();

  const cols = [['Material ID', 90], ['Description', 200], ['Unit', 60], ['Current Qty', 80], ['Rate', 80], ['Stock Value', 100], ['Status', 90]];
  const row = (cells, bold) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y;
    let x = 40;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cells.forEach((c, i) => { doc.text(String(c), x, y, { width: cols[i][1] - 6, lineBreak: false, ellipsis: true }); x += cols[i][1]; });
    doc.y = y + 16;
    doc.x = 40;
  };
  row(cols.map((c) => c[0]), true);
  let any = false;
  const cursor = activeMaterialCursor();
  try {
    for await (const m of cursor) {
      any = true;
      row([m.materialId, m.description, m.unit, m.currentQuantity, m.currentRate.toFixed(2), m.stockValue.toFixed(2), STATUS[m.status]]);
    }
  } finally { await cursor.close().catch(() => {}); }
  if (!any) doc.font('Helvetica').text('No materials.', 40);
  doc.end();
});

function parseDate(v, name, endOfDay) {
  if (v === undefined || v === '') return null;
  const d = new Date(v);
  if (typeof v !== 'string' || Number.isNaN(+d)) throw fail(`Invalid ${name} date`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(v)) d.setUTCHours(23, 59, 59, 999); // date-only "to" is inclusive
  return d;
}

exports.movementsExcel = wrap(async (req, res) => {
  const { material } = req.query;
  const filter = {};
  if (material !== undefined && material !== '') {
    if (!isId(material)) throw fail('Invalid material id');
    filter.material = material;
  }
  const from = parseDate(req.query.from, 'from'), to = parseDate(req.query.to, 'to', true);
  if (from && to && from > to) throw fail('"from" must not be after "to"');
  if (from || to) filter.movementDate = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

  const cursor = Movement.find(filter).sort(ORDER).populate('material', 'materialId description').populate('createdBy', 'name').cursor({ batchSize: BATCH });
  await streamWorkbook(res, `movements-${stamp()}.xlsx`, 'Movements', [
    { header: 'Date', key: 'date', width: 14 }, { header: 'Material ID', key: 'id', width: 16 },
    { header: 'Description', key: 'desc', width: 28 }, { header: 'Type', key: 'type', width: 10 },
    { header: 'Qty', key: 'qty', width: 12 }, { header: 'Rate', key: 'rate', width: 12 },
    { header: 'Amount', key: 'amount', width: 14 }, { header: 'Balance', key: 'bal', width: 12 },
    { header: 'Entered By', key: 'by', width: 20 }, { header: 'Note', key: 'note', width: 30 },
  ], cursorRows(cursor, (m) => ({
    date: m.movementDate.toISOString().slice(0, 10), id: m.material && m.material.materialId,
    desc: m.material && m.material.description, type: m.type, qty: m.quantity, rate: m.rate,
    amount: m.amount, bal: m.balanceAfter, by: m.createdBy && m.createdBy.name, note: m.note || '',
  })));
});
