const assert = require('assert');
const mongoose = require('mongoose');
const User = require('../models/User');
const Material = require('../models/Material');
const Movement = require('../models/Movement');
const AuditLog = require('../models/AuditLog');
const id = () => new mongoose.Types.ObjectId();
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.log('FAIL', n, e.message); } };
const bad = (n, doc, path) => t(n, () => {
  const err = doc.validateSync();
  assert(err && err.errors[path], 'expected error on ' + path);
});
const ok = (n, doc) => t(n, () => assert.ifError(doc.validateSync()));

const u = { name: 'Alice', email: 'a@b.com', passwordHash: 'x' };
ok('user valid', new User(u));
t('user defaults', () => { const d = new User(u); assert(d.role === 'user' && d.status === 'pending'); });
bad('user bad email', new User({ ...u, email: 'nope' }), 'email');
bad('user bad role', new User({ ...u, role: 'root' }), 'role');
bad('user bad status', new User({ ...u, status: 'x' }), 'status');
bad('user no name', new User({ ...u, name: undefined }), 'name');
bad('user no hash', new User({ ...u, passwordHash: undefined }), 'passwordHash');

const m = { materialId: 'mat001', description: 'Cement', unit: 'Bag' };
ok('material valid', new Material(m));
t('material uppercase', () => assert.strictEqual(new Material(m).materialId, 'MAT001'));
for (const f of ['openingRate', 'openingQuantity', 'currentRate', 'minimumQuantity'])
  bad('material neg ' + f, new Material({ ...m, [f]: -1 }), f);
bad('material no id', new Material({ ...m, materialId: undefined }), 'materialId');
bad('material no desc', new Material({ ...m, description: undefined }), 'description');
t('virt AVAILABLE', () => {
  const d = new Material({ ...m, currentQuantity: 120, currentRate: 400, minimumQuantity: 50 });
  assert(d.status === 'AVAILABLE' && d.stockValue === 48000);
});
t('virt LOW', () => assert.strictEqual(new Material({ ...m, currentQuantity: 15, minimumQuantity: 20 }).status, 'LOW_STOCK'));
t('virt LOW boundary', () => assert.strictEqual(new Material({ ...m, currentQuantity: 20, minimumQuantity: 20 }).status, 'LOW_STOCK'));
t('currentQuantity may be negative', () => assert.ifError(new Material({ ...m, currentQuantity: -360 }).validateSync()));
t('virt OUT', () => assert.strictEqual(new Material({ ...m, currentQuantity: 0 }).status, 'OUT_OF_STOCK'));
t('virt in toJSON', () => { const j = new Material(m).toJSON(); assert('status' in j && 'stockValue' in j); });

const mv = { material: id(), type: 'IN', quantity: 10, rate: 5, amount: 50, balanceAfter: 10 };
ok('movement valid', new Movement(mv));
bad('movement qty 0', new Movement({ ...mv, quantity: 0 }), 'quantity');
bad('movement qty neg', new Movement({ ...mv, quantity: -3 }), 'quantity');
bad('movement bad type', new Movement({ ...mv, type: 'MOVE' }), 'type');
bad('movement neg rate', new Movement({ ...mv, rate: -1 }), 'rate');
bad('movement neg enteredRate', new Movement({ ...mv, enteredRate: -1 }), 'enteredRate');
bad('movement no material', new Movement({ ...mv, material: undefined }), 'material');
t('movement defaults', () => {
  const d = new Movement(mv);
  assert(d.exceededStock === false && d.isEdited === false && d.movementDate);
});

ok('audit valid', new AuditLog({ action: 'LOGIN' }));
bad('audit no action', new AuditLog({}), 'action');
t('audit default details', () => assert.deepStrictEqual(new AuditLog({ action: 'x' }).details, {}));

console.log(`phase1: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
