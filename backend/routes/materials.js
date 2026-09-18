const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const c = require('../controllers/materialController');

const nonNeg = (f, req) => {
  const v = body(f).isFloat({ min: 0 }).withMessage(`${f} must be a number >= 0`);
  return req ? v : v.optional();
};
const str = (f, req) => {
  const v = body(f).isString().trim().notEmpty().withMessage(`${f} required`);
  return req ? v : v.optional();
};

router.use(requireAuth);
router.get('/', c.list);
router.get('/:id', c.get);

// admin-only writes. No DELETE route exists by design (soft delete only).
router.post('/', requireAdmin,
  str('materialId', true), str('description', true), str('unit', true),
  nonNeg('openingRate'), nonNeg('openingQuantity'), nonNeg('minimumQuantity'),
  validate, c.create);
router.put('/:id', requireAdmin,
  str('description'), str('unit'),
  nonNeg('openingRate'), nonNeg('openingQuantity'), nonNeg('minimumQuantity'),
  validate, c.update);
router.patch('/:id/deactivate', requireAdmin, c.deactivate);
router.patch('/:id/reactivate', requireAdmin, c.reactivate);

module.exports = router;
