// The single way to create a movement: lock the material, load it, refuse if inactive, then post it through the
// costing engine (utils/costing.js postMovement, which also enforces the OUT-beyond-stock rule).
// Used by POST /movements and by the stock-import commit, so both share exactly one implementation.
const Material = require('../models/Material');
const { postMovement, withLock } = require('./costing');
const { httpError } = require('./errors');

// input = { type, quantity, enteredRate, movementDate, note, createdBy }. The caller MUST already hold the material's lock.
async function createMovementLocked(materialId, input) {
  const material = await Material.findById(materialId);
  if (!material || !material.isActive) throw httpError(404, 'Material not found or inactive');
  return postMovement(material, input);
}

const createMovement = (materialId, input) =>
  withLock(String(materialId).toLowerCase(), () => createMovementLocked(materialId, input)); // same key whatever the hex case

module.exports = { createMovement, createMovementLocked };
