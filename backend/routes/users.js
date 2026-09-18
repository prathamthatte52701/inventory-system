const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const c = require('../controllers/userController');

router.use(requireAuth, requireAdmin);
router.get('/', c.list);
router.patch('/:id/approve', c.approve);
router.patch('/:id/reject', c.reject);

module.exports = router;
