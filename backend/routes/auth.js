const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { username, emailField, password } = require('../middleware/fields');
const c = require('../controllers/authController');

const email = body('email').isString().withMessage('Valid email required').bail().trim().isEmail().withMessage('Valid email required')
  .bail().isLength({ max: 254 }).withMessage('Email too long');

// signup: strict format rules, checked before the controller (and therefore before the rate limiter is charged)
router.post('/signup', username('name'), emailField('email'), password('password'), validate, c.signup);
router.post('/login', email, body('password').isString().isLength({ min: 1, max: 128 }).withMessage('Password required'), validate, c.login);
router.post('/logout', c.logout);
router.get('/me', requireAuth, c.me);

module.exports = router;
