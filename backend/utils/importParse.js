// Parsers for stock-import files. Each returns { rows, errors, mode }; rows are fully parsed, errors are {row, message}.
const ExcelJS = require('exceljs');
const mammoth = require('mammoth');
const { parseNum } = require('../middleware/fields');
const { httpError } = require('./errors');

const HEADERS = ['EDP No', 'Size', 'Stock Qty', 'Receipt Qty', 'Rate', 'Issue Qty', 'Balance Qty', 'Receive Date', 'Issue Date'];
// "Material ID" / "Description" are the real-world names the same two columns are also known by. "Current Qty" is a
// second, distinct file shape (see MODE below). "Stock Value" and "Status" are the app's own computed columns
// (qty x rate, and the status virtual) — recognised so their presence never confuses header detection, but never
// read: they are never stored or trusted as input.
const KEYS = {
  'edp no': 'edp', 'material id': 'edp',
  size: 'size', description: 'size',
  'stock qty': 'stock', rate: 'rate', 'balance qty': 'balance',
  'receipt qty': 'receipt', 'issue qty': 'issue', 'receive date': 'receiveDate', 'issue date': 'issueDate',
  unit: 'unit', 'current qty': 'current',
  'stock value': null, status: null,
};
// Only an identifier ("EDP No" / "Material ID") is required to recognise the header row. What comes after decides
// the MODE, chosen once from the header row, never per row:
//   MOVEMENT (Receipt Qty and/or Issue Qty present) — the existing transaction-file behaviour, unchanged; a
//     Current Qty column, if also present, is ignored (a file with real transaction columns IS a transaction file).
//   SYNC (no Receipt/Issue, but Current Qty present) — a snapshot of today's balance; see importPlan.js.
//   neither — rejected: there is nothing to import.
const notFound = (got) => httpError(400, `Could not find a table with an "EDP No" (or "Material ID") column — got: ${got}`);
const noQty = () => httpError(400, 'File needs at least a Receipt Qty, Issue Qty, or Current Qty column (optional: Size/Description, Unit, Stock Qty, Rate, Balance Qty, Receive Date, Issue Date)');
const headerIndex = (cells) => { const idx = {}; (cells || []).forEach((h, i) => { const k = KEYS[norm(h)]; if (k && !(k in idx)) idx[k] = i; }); return idx; };
const modeOf = (idx) => (('receipt' in idx || 'issue' in idx) ? 'movement' : ('current' in idx ? 'sync' : null));
const today = () => new Date().toISOString().slice(0, 10); // the day the file is imported (UTC, like every other movement day)

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const norm = (v) => String(v ?? '').trim().toLowerCase();

function num(v, label) {
  if (blank(v)) return null;
  const n = typeof v === 'number' ? parseNum(v) : typeof v === 'string' ? parseNum(v.replace(/,/g, '')) : NaN;
  if (Number.isNaN(n)) throw new Error(`${label} must be a non-negative number`);
  return n;
}

const ymd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
function date(v, label) {
  if (blank(v)) return null;
  let out = null;
  if (v instanceof Date) out = Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  else if (typeof v === 'string') {
    const s = v.trim();
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) out = ymd(+m[1], +m[2], +m[3]);
    else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s))) out = ymd(+m[3], +m[2], +m[1]);
  }
  if (!out) throw new Error(`${label} is not a valid date`);
  return out;
}

// c: raw cell values keyed by field. Returns a parsed row or null (fully blank); throws Error for row problems.
// has: which columns exist in the file at all. A whole missing date column defaults to today (row.receiveDefault / issueDefault
// tell the plan to warn); a date column that exists but is blank on this row is still an error.
function parseRow(row, c, has) {
  if (Object.values(c).every(blank)) return null;
  const edp = blank(c.edp) ? '' : String(c.edp).trim();
  if (!edp) throw new Error('EDP No is missing');
  const stockRaw = num(c.stock, 'Stock Qty');
  const r = {
    row, edp, size: blank(c.size) ? '' : String(c.size).trim(), unit: blank(c.unit) ? '' : String(c.unit).trim(),
    stock: stockRaw ?? 0, stockGiven: stockRaw !== null, receipt: num(c.receipt, 'Receipt Qty') ?? 0, rate: num(c.rate, 'Rate'),
    issue: num(c.issue, 'Issue Qty') ?? 0, balance: null, current: num(c.current, 'Current Qty'),
    receiveDate: date(c.receiveDate, 'Receive Date'), issueDate: date(c.issueDate, 'Issue Date'),
  };
  if (r.current !== null && r.current < 0) throw new Error('Current Qty must be a non-negative number');
  try { r.balance = num(c.balance, 'Balance Qty'); } catch { r.balance = null; } // informational only
  if (r.receipt > 0 && !r.receiveDate) {
    if (has.receiveDate) throw new Error('Receive Date is required when Receipt Qty is given');
    r.receiveDate = today(); r.receiveDefault = true;
  }
  if (r.issue > 0 && !r.issueDate) {
    if (has.issueDate) throw new Error('Issue Date is required when Issue Qty is given');
    r.issueDate = today(); r.issueDefault = true;
  }
  return r;
}

// grid: [{ row, cells: [..] }] with grid[0] the header row.
// Returns null when grid[0] isn't a usable header row at all (no identifier — keep scanning, tolerates title rows),
// { noQty: true } when an identifier was found but neither a transaction nor a snapshot column exists (stop here),
// or { rows, errors, mode }.
function parseGrid(grid) {
  const idx = headerIndex(grid[0] && grid[0].cells);
  if (!('edp' in idx)) return null;
  const mode = modeOf(idx);
  if (!mode) return { rows: [], errors: [], noQty: true };
  const has = Object.fromEntries(Object.keys(idx).map((k) => [k, true]));
  const rows = [], errors = [];
  for (const { row, cells } of grid.slice(1)) {
    const c = {};
    for (const k in idx) c[k] = cells[idx[k]];
    try { const r = parseRow(row, c, has); if (r) rows.push(r); } catch (e) { errors.push({ row, message: e.message }); }
  }
  return { rows, errors, mode };
}

function cellVal(v) {
  if (v === null || v === undefined || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellVal(v.result);
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
    return null;
  }
  return v;
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw httpError(400, 'Could not read this file as an .xlsx spreadsheet'); }
  const ws = wb.worksheets[0];
  if (!ws) throw notFound('no sheet');
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    const cells = [];
    for (let i = 1; i <= Math.max(r.cellCount, 9); i++) cells.push(cellVal(r.getCell(i).value));
    grid.push({ row: n, cells });
  });
  // the header row is the first row containing an identifier (title rows above it are tolerated)
  for (let i = 0; i < grid.length; i++) {
    const res = parseGrid(grid.slice(i));
    if (res && res.noQty) throw noQty();
    if (res) return res;
  }
  throw notFound(grid[0] ? grid[0].cells.map((c) => String(c ?? '').trim()).filter(Boolean).join(', ') || 'no header row' : 'no header row');
}

const decode = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function parseDocx(buffer) {
  let html;
  try { html = (await mammoth.convertToHtml({ buffer })).value; } catch { throw notFound('unreadable document'); }
  const t = /<table[\s\S]*?<\/table>/i.exec(html);
  if (!t) throw notFound('no table');
  const grid = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr, i) => ({
    row: i + 1, cells: [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decode(c[1])),
  }));
  const res = parseGrid(grid);
  if (!res) throw notFound(grid[0] ? grid[0].cells.join(', ') : 'no table');
  if (res.noQty) throw noQty();
  return res;
}

module.exports = { HEADERS, parseXlsx, parseDocx };
