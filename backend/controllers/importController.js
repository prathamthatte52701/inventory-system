const multer = require('multer');
const Material = require('../models/Material');
const ImportBatch = require('../models/ImportBatch');
const audit = require('../utils/audit');
const { withLock } = require('../utils/costing');
const { createMovementLocked } = require('../utils/movementService');
const { parseXlsx, parseDocx } = require('../utils/importParse');
const { buildPlan, isDuplicate } = require('../utils/importPlan');
const { parseNum } = require('../middleware/fields');
const { httpError, wrap } = require('../utils/errors');
const { paginate, pageEnvelope } = require('../utils/pagination');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ITEMS = 5000;
const uploadOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single('file');
const receive = (req, res) => new Promise((resolve, reject) => uploadOne(req, res, (e) => {
  if (!e) return resolve();
  reject(httpError(400, e.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 10 MB)' : `Upload failed: ${e.message}`));
}));

exports.preview = wrap(async (req, res) => {
  await receive(req, res);
  const f = req.file;
  if (!f) throw httpError(400, 'No file uploaded (send it as multipart field "file")');
  const name = f.originalname || 'upload';
  const ext = (/\.([^.]+)$/.exec(name) || [])[1]?.toLowerCase();
  if (ext === 'xls') throw httpError(400, 'Legacy .xls files cannot be read. Please re-save the file as .xlsx (Excel Workbook) and upload it again.');
  if (ext !== 'xlsx' && ext !== 'docx') throw httpError(400, 'Unsupported file type. Upload an .xlsx (or .docx) file.');
  const { rows, errors, mode } = await (ext === 'xlsx' ? parseXlsx : parseDocx)(f.buffer);
  res.json({ filename: name.slice(0, 255), mode, ...(await buildPlan(rows, errors, mode)) });
});

const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) && new Date(s).toISOString().slice(0, 10) === s;

// Returns a clean movement or a string describing why it is invalid. The client's `status` is never read.
function cleanMovement(m) {
  if (!m || typeof m !== 'object') return 'Invalid movement';
  if (m.type !== 'IN' && m.type !== 'OUT') return 'type must be IN or OUT';
  if (!Number.isInteger(m.row) || m.row < 1) return 'row must be a positive whole number';
  if (typeof m.edp !== 'string' || !m.edp.trim()) return 'EDP is missing';
  const quantity = parseNum(m.quantity, { min: 0.0001 });
  if (Number.isNaN(quantity)) return 'quantity must be a positive number';
  let enteredRate = null;
  if (m.type === 'IN') {
    enteredRate = m.rate === null || m.rate === undefined || m.rate === '' ? NaN : parseNum(m.rate);
    if (Number.isNaN(enteredRate)) return 'IN requires a rate';
  }
  if (!validDay(m.movementDate)) return 'movementDate must be YYYY-MM-DD';
  return { row: m.row, edp: m.edp.trim().toUpperCase(), type: m.type, quantity, enteredRate, movementDate: new Date(m.movementDate) };
}

// Sync-mode rows only carry a row/edp/id and the file's stated absolute quantity (targetQty) plus an optional rate.
// Deliberately does NOT trust a preview-time type/quantity/delta: the actual adjustment is computed fresh at
// commit time, inside the material's lock, against whatever the material's balance is right now (see step 3).
function cleanSyncItem(m) {
  if (!m || typeof m !== 'object') return 'Invalid movement';
  if (!Number.isInteger(m.row) || m.row < 1) return 'row must be a positive whole number';
  if (typeof m.edp !== 'string' || !m.edp.trim()) return 'EDP is missing';
  const targetQty = parseNum(m.targetQty, { min: 0 });
  if (Number.isNaN(targetQty)) return 'targetQty must be a non-negative number';
  let rate = null;
  if (m.rate !== null && m.rate !== undefined && m.rate !== '') {
    rate = parseNum(m.rate, { min: 0 });
    if (Number.isNaN(rate)) return 'rate must be a non-negative number';
  }
  return { row: m.row, edp: m.edp.trim().toUpperCase(), targetQty, rate };
}

function cleanMaterial(m) {
  if (!m || typeof m.edp !== 'string' || !m.edp.trim()) return null;
  const openingQuantity = m.openingQuantity === undefined ? 0 : parseNum(m.openingQuantity);
  const openingRate = m.openingRate === undefined ? 0 : parseNum(m.openingRate);
  if (Number.isNaN(openingQuantity) || Number.isNaN(openingRate)) return null;
  const edp = m.edp.trim().toUpperCase();
  const unit = typeof m.unit === 'string' && m.unit.trim() ? m.unit.trim().slice(0, 30) : 'TBD'; // the file's Unit column, or the usual placeholder
  return { edp, description: String(m.description || edp).trim().slice(0, 200) || edp, unit, openingQuantity, openingRate };
}

exports.commit = wrap(async (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.movements) || b.movements.length > MAX_ITEMS) throw httpError(400, `movements must be an array of at most ${MAX_ITEMS}`);
  if (b.materials !== undefined && (!Array.isArray(b.materials) || b.materials.length > MAX_ITEMS)) throw httpError(400, `materials must be an array of at most ${MAX_ITEMS}`);
  const filename = typeof b.filename === 'string' && b.filename.trim() ? b.filename.trim().slice(0, 255) : 'import';

  // 1. validate everything, split by mode
  const results = [];
  const items = [], syncItems = [];
  b.movements.forEach((raw, i) => {
    const row = raw && Number.isInteger(raw.row) ? raw.row : null;
    const id = raw && typeof raw.id === 'string' ? raw.id.slice(0, 40) : `r${row}-${raw && raw.type}`;
    const r = { id, row, edp: raw && typeof raw.edp === 'string' ? raw.edp.trim().toUpperCase() : null, type: raw && raw.mode === 'sync' ? null : raw && raw.type };
    results[i] = r;
    if (raw && raw.mode === 'sync') {
      const c = cleanSyncItem(raw);
      if (typeof c === 'string') { r.status = 'failed'; r.reason = c; } else syncItems.push({ ...c, r });
      return;
    }
    const c = cleanMovement(raw);
    if (typeof c === 'string') { r.status = 'failed'; r.reason = c; } else items.push({ ...c, r });
  });

  // sync mode: only the last row per material is authoritative (mirrors the preview's own rule); earlier
  // duplicates for the same material never touch the database
  const syncByEdp = new Map();
  for (const it of syncItems) {
    const prev = syncByEdp.get(it.edp);
    if (!prev || it.row > prev.row) syncByEdp.set(it.edp, it);
  }
  for (const it of syncItems) {
    if (syncByEdp.get(it.edp) !== it) { it.r.status = 'skipped-duplicate'; it.r.reason = 'superseded by a later row for this material in this file'; }
  }
  const syncWinners = [...syncByEdp.values()];

  // 2. materials: create the still-missing ones from the plan
  const wanted = new Map();
  for (const raw of b.materials || []) { const m = cleanMaterial(raw); if (m && !wanted.has(m.edp)) wanted.set(m.edp, m); }
  const have = new Map((await Material.find({ materialId: { $in: [...new Set([...wanted.keys(), ...items.map((x) => x.edp), ...syncWinners.map((x) => x.edp)])] } })).map((m) => [m.materialId, m]));
  const createdMaterials = [];
  for (const m of wanted.values()) {
    if (have.has(m.edp)) continue;
    try {
      const doc = await Material.create({ // current* start equal to opening, exactly like POST /materials
        materialId: m.edp, description: m.description, unit: m.unit, openingQuantity: m.openingQuantity, openingRate: m.openingRate,
        currentQuantity: m.openingQuantity, currentRate: m.openingRate, createdBy: req.user._id,
      });
      have.set(m.edp, doc);
      createdMaterials.push({ materialId: doc.materialId, description: doc.description, unit: doc.unit });
    } catch (e) {
      if (e.code !== 11000) throw e;
      have.set(m.edp, await Material.findOne({ materialId: m.edp })); // created concurrently: use theirs
    }
  }

  // 3. movement-mode: post per material, oldest first, holding that material's lock once
  const groups = new Map();
  for (const it of items) {
    const mat = have.get(it.edp);
    if (!mat) { it.r.status = 'failed'; it.r.reason = 'Unknown material'; continue; }
    if (mat.isActive === false) { it.r.status = 'failed'; it.r.reason = 'Material is inactive'; continue; }
    if (!groups.has(it.edp)) groups.set(it.edp, []);
    groups.get(it.edp).push(it);
  }
  for (const [edp, list] of groups) {
    list.sort((a, c) => a.movementDate - c.movementDate || a.row - c.row || (a.type === c.type ? 0 : a.type === 'IN' ? -1 : 1));
    const matId = have.get(edp)._id;
    await withLock(String(matId).toLowerCase(), async () => {
      for (const it of list) {
        try {
          if (await isDuplicate(matId, it)) { it.r.status = 'skipped-duplicate'; it.r.reason = 'Identical movement already exists'; continue; }
          const out = await createMovementLocked(matId, {
            type: it.type, quantity: it.quantity, enteredRate: it.enteredRate, movementDate: it.movementDate,
            note: `Imported: ${filename} (row ${it.row})`.slice(0, 500), createdBy: req.user._id,
          });
          it.r.status = 'created'; it.r.balanceAfter = out.movement.balanceAfter;
        } catch (e) {
          it.r.status = 'failed'; it.r.reason = e.status ? e.message : 'Could not record this movement';
          if (!e.status) console.error('[import commit]', e.message);
        }
      }
    }).catch((e) => { // e.g. lock busy: everything still pending for this material failed
      for (const it of list) if (!it.r.status) { it.r.status = 'failed'; it.r.reason = e.status ? e.message : 'Could not record this movement'; }
    });
  }

  // 3b. sync mode: one adjustment per material, computed fresh inside its lock — never the preview's delta, so a
  // stock change between preview and commit can't produce a wrong or negative-crossing adjustment.
  for (const it of syncWinners) {
    if (it.r.status) continue; // already resolved as a superseded duplicate above
    const mat = have.get(it.edp);
    if (!mat) { it.r.status = 'failed'; it.r.reason = 'Unknown material'; continue; }
    if (mat.isActive === false) { it.r.status = 'failed'; it.r.reason = 'Material is inactive'; continue; }
    await withLock(String(mat._id).toLowerCase(), async () => {
      const fresh = await Material.findById(mat._id); // the balance right now, inside the lock
      const delta = Math.round((it.targetQty - fresh.currentQuantity) * 1e4) / 1e4;
      if (delta === 0) { it.r.status = 'skipped-duplicate'; it.r.reason = 'Current Qty already matches the system; no change needed'; return; }
      const type = delta > 0 ? 'IN' : 'OUT';
      const enteredRate = type === 'IN' ? (it.rate !== null ? it.rate : fresh.currentRate) : null;
      try {
        const out = await createMovementLocked(fresh._id, {
          type, quantity: Math.abs(delta), enteredRate, movementDate: new Date(),
          note: `Stock sync from import: file states ${it.targetQty}, system had ${fresh.currentQuantity}`.slice(0, 500),
          createdBy: req.user._id,
        });
        it.r.status = 'created'; it.r.balanceAfter = out.movement.balanceAfter;
      } catch (e) {
        it.r.status = 'failed'; it.r.reason = e.status ? e.message : 'Could not record this adjustment';
        if (!e.status) console.error('[import commit sync]', e.message);
      }
    }).catch((e) => {
      if (!it.r.status) { it.r.status = 'failed'; it.r.reason = e.status ? e.message : 'Could not record this adjustment'; }
    });
  }

  // 4. one metadata doc + one audit entry
  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = { rowCount: new Set(results.map((r) => r.row)).size, created: count('created'), skipped: count('skipped-duplicate'), failed: count('failed'), newMaterials: createdMaterials.length };
  const batch = await ImportBatch.create({ filename, uploadedBy: req.user._id, rowCount: summary.rowCount, createdCount: summary.created, skippedCount: summary.skipped, rejectedCount: summary.failed });
  await audit(req, 'IMPORT_COMMIT', 'ImportBatch', batch._id, { filename, createdCount: summary.created, skippedCount: summary.skipped, rejectedCount: summary.failed });
  res.json({ batchId: batch._id, filename, summary, createdMaterials, results });
});

exports.list = wrap(async (req, res) => {
  const pg = paginate(req.query);
  const total = await ImportBatch.countDocuments();
  const data = pg.skip >= total ? [] : await ImportBatch.find().sort({ uploadedAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).populate('uploadedBy', 'name').lean();
  res.json(pageEnvelope(data.map((d) => ({ _id: d._id, filename: d.filename, uploadedBy: d.uploadedBy ? { _id: d.uploadedBy._id, name: d.uploadedBy.name } : null, uploadedAt: d.uploadedAt, rowCount: d.rowCount, createdCount: d.createdCount, skippedCount: d.skippedCount, rejectedCount: d.rejectedCount })), pg, total));
});
