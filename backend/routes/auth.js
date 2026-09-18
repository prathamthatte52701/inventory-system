const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { str } = require('../middleware/fields');
const c = require('../controllers/authController');

const email = body('email').isString().withMessage('Valid email required').bail().trim().isEmail().withMessage('Valid email required')
  .bail().isLength({ max: 254 }).withMessage('Email too long');
const password = body('password').isString().isLength({ min: 6, max: 128 }).withMessage('Password must be 6-128 chars');

router.post('/signup', str('name', { max: 100, required: true }), email, password, validate, c.signup);
router.post('/login', email, body('password').isString().isLength({ min: 1, max: 128 }).withMessage('Password required'), validate, c.login);
router.post('/logout', c.logout);
router.get('/me', requireAuth, c.me);

module.exports = router;
