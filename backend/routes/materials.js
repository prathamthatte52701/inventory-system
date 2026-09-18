const router = require('express').Router();
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { num, str } = require('../middleware/fields');
const c = require('../controllers/materialController');

const nums = [num('openingRate'), num('openingQuantity'), num('minimumQuantity')];

router.use(requireAuth);
router.get('/', c.list);
router.get('/:id', c.get);

// admin-only writes. No DELETE route exists by design (soft delete only).
router.post('/', requireAdmin,
  str('materialId', { max: 50, required: true }), str('description', { max: 200, required: true }), str('unit', { max: 30, required: true }),
  ...nums, validate, c.create);
router.put('/:id', requireAdmin,
  str('description', { max: 200 }), str('unit', { max: 30 }),
  ...nums, validate, c.update);
router.patch('/:id/deactivate', requireAdmin, c.deactivate);
router.patch('/:id/reactivate', requireAdmin, c.reactivate);

module.exports = router;
