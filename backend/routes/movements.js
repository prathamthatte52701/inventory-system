const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const c = require('../controllers/movementController');

const qty = (o) => { const v = body('quantity').isFloat({ min: 0.0001 }).withMessage('quantity must be a number > 0'); return o ? v.optional() : v; };
const type = (o) => { const v = body('type').isIn(['IN', 'OUT', 'RETURN']).withMessage('type must be IN, OUT or RETURN'); return o ? v.optional() : v; };
const date = body('movementDate').optional().isISO8601().withMessage('movementDate must be a valid date');
const note = body('note').optional().isString().isLength({ max: 500 });
const rates = [
  body('rate').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('rate must be >= 0'),
  body('enteredRate').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('enteredRate must be >= 0'),
];

router.use(requireAuth);
router.get('/', c.list);
// rate validation applies to IN only; for OUT/RETURN any rate is ignored by the controller
router.post('/', body('material').isMongoId().withMessage('material must be a valid id'), type(false), qty(false), date, note,
  (req, res, next) => (req.body.type === 'IN' ? Promise.all(rates.map((r) => r.run(req))).then(() => next()) : next()),
  validate, c.create);
router.put('/:id', requireAdmin, type(true), qty(true), date, note,
  (req, res, next) => (req.body.type === 'IN' || req.body.type === undefined ? Promise.all(rates.map((r) => r.run(req))).then(() => next()) : next()),
  validate, c.update);

module.exports = router;
