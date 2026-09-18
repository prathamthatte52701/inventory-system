const router = require('express').Router();
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { num, str, oneOf, objectId, date } = require('../middleware/fields');
const c = require('../controllers/movementController');

// The paid rate (rate / enteredRate) is validated in the controller, and only when the movement is an IN;
// on OUT/RETURN it is ignored on purpose.
router.use(requireAuth);
router.get('/', c.list);
router.post('/',
  objectId('material'), oneOf('type', ['IN', 'OUT', 'RETURN']), num('quantity', { min: 0.0001, required: true }),
  date('movementDate'), str('note', { max: 500 }),
  validate, c.create);
router.put('/:id', requireAdmin,
  oneOf('type', ['IN', 'OUT', 'RETURN'], { required: false }), num('quantity', { min: 0.0001 }),
  date('movementDate'), str('note', { max: 500 }),
  validate, c.update);

module.exports = router;
