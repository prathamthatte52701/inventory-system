// Parsers for stock-import files. Each returns { rows, errors }; rows are fully parsed, errors are {row, message}.
const ExcelJS = require('exceljs');
const mammoth = require('mammoth');
const { parseNum } = require('../middleware/fields');
const { httpError } = require('./errors');

const HEADERS = ['EDP No', 'Size', 'Stock Qty', 'Receipt Qty', 'Rate', 'Issue Qty', 'Balance Qty', 'Receive Date', 'Issue Date'];
const KEYS = { 'edp no': 'edp', size: 'size', 'stock qty': 'stock', 'receipt qty': 'receipt', rate: 'rate', 'issue qty': 'issue', 'balance qty': 'balance', 'receive date': 'receiveDate', 'issue date': 'issueDate' };
const notFound = (got) => httpError(400, `Could not find a table with columns ${HEADERS.join(', ')} — got: ${got}`);

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
function parseRow(row, c) {
  if (Object.values(c).every(blank)) return null;
  const edp = blank(c.edp) ? '' : String(c.edp).trim();
  if (!edp) throw new Error('EDP No is missing');
  const r = {
    row, edp, size: blank(c.size) ? '' : String(c.size).trim(),
    stock: num(c.stock, 'Stock Qty') ?? 0, receipt: num(c.receipt, 'Receipt Qty') ?? 0, rate: num(c.rate, 'Rate'),
    issue: num(c.issue, 'Issue Qty') ?? 0, balance: null,
    receiveDate: date(c.receiveDate, 'Receive Date'), issueDate: date(c.issueDate, 'Issue Date'),
  };
  try { r.balance = num(c.balance, 'Balance Qty'); } catch { r.balance = null; } // informational only
  if (r.receipt > 0 && !r.receiveDate) throw new Error('Receive Date is required when Receipt Qty is given');
  if (r.issue > 0 && !r.issueDate) throw new Error('Issue Date is required when Issue Qty is given');
  return r;
}

// grid: [{ row, cells: [..] }] with grid[0] the header row; null if it lacks any expected header
function parseGrid(grid) {
  const idx = {};
  (grid[0] ? grid[0].cells : []).forEach((h, i) => { const k = KEYS[norm(h)]; if (k && !(k in idx)) idx[k] = i; });
  if (Object.keys(idx).length !== HEADERS.length) return null;
  const rows = [], errors = [];
  for (const { row, cells } of grid.slice(1)) {
    const c = {};
    for (const k in idx) c[k] = cells[idx[k]];
    try { const r = parseRow(row, c); if (r) rows.push(r); } catch (e) { errors.push({ row, message: e.message }); }
  }
  return { rows, errors };
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
  // the header row is the first row containing every expected header (title rows above it are tolerated)
  for (let i = 0; i < grid.length; i++) {
    const res = parseGrid(grid.slice(i));
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
  return res;
}

module.exports = { HEADERS, parseXlsx, parseDocx };
