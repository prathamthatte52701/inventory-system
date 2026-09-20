const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const c = require('../controllers/userController');

router.use(requireAuth, requireAdmin);
router.get('/', c.list);
router.get('/:id/activity', c.activity);
router.patch('/:id/approve', c.approve);
router.patch('/:id/reject', c.reject);
router.patch('/:id/role', c.setRole);
router.patch('/:id/deactivate', c.deactivate);
router.patch('/:id/reactivate', c.reactivate);

module.exports = router;
