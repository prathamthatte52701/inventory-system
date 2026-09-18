const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/authController');

const email = body('email').isString().trim().isEmail().withMessage('Valid email required');
const password = body('password').isString().isLength({ min: 6, max: 128 }).withMessage('Password must be 6-128 chars');

router.post('/signup', body('name').isString().trim().notEmpty().withMessage('Name required'), email, password, validate, c.signup);
router.post('/login', email, body('password').isString().notEmpty(), validate, c.login);
router.get('/me', requireAuth, c.me);

module.exports = router;
